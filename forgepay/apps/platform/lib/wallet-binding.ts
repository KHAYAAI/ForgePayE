/**
 * Bring your own wallet: link a wallet the user controls to an agent, by a signed message.
 *
 * FORGE's hosted wallet keeps keys on its own infrastructure, which is custody. This is the non-custodial path: the user keeps
 * the key in their own wallet (MetaMask, a hardware wallet, anything that can sign a message), signs a challenge that names the
 * address and the agent, and the console checks the signature. FORGE never sees a key, and the signature moves no funds.
 *
 * A challenge is bound to the workspace, the address and the agent; it is single-use and lasts ten minutes. The signature is
 * recovered server-side, so the browser cannot claim an address it does not control.
 */

import { randomBytes } from 'node:crypto';
import { getAddress, isAddress, recoverMessageAddress, type Hex } from 'viem';
import { query, queryOne } from './db';

export const CHALLENGE_TTL_MS = 10 * 60 * 1000;
const AGENT_ID = /^[A-Za-z0-9_.:-]{1,120}$/;

export interface ChallengeInput { tenantId: string; address: string; agentId: string }

export function challengeMessage(i: { tenantId: string; address: string; agentId: string; nonce: string; issuedAt: string; expiresAt: string }): string {
  return [
    'FORGE: link this wallet to an agent',
    '',
    `Address: ${i.address}`,
    `Agent: ${i.agentId}`,
    `Workspace: ${i.tenantId}`,
    `Nonce: ${i.nonce}`,
    `Issued: ${i.issuedAt}`,
    `Expires: ${i.expiresAt}`,
    '',
    'Signing proves you control this wallet. It does not move funds and gives FORGE no access to your keys.',
  ].join('\n');
}

export type ChallengeOutcome =
  | { ok: true; nonce: string; message: string; expiresAt: string; address: string }
  | { ok: false; status: number; error: string; message: string };

export async function createWalletChallenge(input: ChallengeInput, now = Date.now()): Promise<ChallengeOutcome> {
  if (typeof input.address !== 'string' || !isAddress(input.address, { strict: false })) {
    return { ok: false, status: 400, error: 'ValidationError', message: 'address must be a 0x-prefixed 20-byte wallet address' };
  }
  if (typeof input.agentId !== 'string' || !AGENT_ID.test(input.agentId)) {
    return { ok: false, status: 400, error: 'ValidationError', message: 'agentId must be 1 to 120 letters, digits, or _ . : -' };
  }
  const address = getAddress(input.address); // checksummed, so the message and the DID are canonical
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + CHALLENGE_TTL_MS).toISOString();
  const message = challengeMessage({ tenantId: input.tenantId, address, agentId: input.agentId, nonce, issuedAt, expiresAt });
  await query(
    `INSERT INTO wallet_challenges (nonce, tenant_id, address, agent_id, message, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [nonce, input.tenantId, address, input.agentId, message, expiresAt],
  );
  return { ok: true, nonce, message, expiresAt, address };
}

interface ChallengeRow { nonce: string; tenant_id: string; address: string; agent_id: string; message: string; expires_at: string; used_at: string | null }

export type VerifyOutcome =
  | { ok: true; address: string; agentId: string }
  | { ok: false; status: number; error: string; message: string };

/**
 * Check a signature against a challenge and spend the challenge. Every refusal says the same thing to the caller about *why*
 * only as far as helps them fix it; none reveals another workspace's challenges (a challenge is looked up by workspace too).
 */
export async function verifyWalletChallenge(tenantId: string, nonce: string, signature: string, now = Date.now()): Promise<VerifyOutcome> {
  if (typeof nonce !== 'string' || !/^[0-9a-f]{32}$/.test(nonce)) {
    return { ok: false, status: 400, error: 'ValidationError', message: 'nonce is not valid' };
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return { ok: false, status: 400, error: 'ValidationError', message: 'signature must be a 65-byte hex signature' };
  }
  const row = await queryOne<ChallengeRow>(
    `SELECT nonce, tenant_id, address, agent_id, message, expires_at, used_at FROM wallet_challenges WHERE nonce = $1 AND tenant_id = $2`,
    [nonce, tenantId],
  );
  if (!row) return { ok: false, status: 404, error: 'NotFound', message: 'No such challenge. Start again.' };
  if (row.used_at) return { ok: false, status: 409, error: 'AlreadyUsed', message: 'That challenge was already used. Start again.' };
  if (Date.parse(row.expires_at) <= now) return { ok: false, status: 410, error: 'Expired', message: 'That challenge expired. Start again.' };

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message: row.message, signature: signature as Hex });
  } catch {
    return { ok: false, status: 400, error: 'BadSignature', message: 'That is not a valid signature.' };
  }
  if (recovered.toLowerCase() !== row.address.toLowerCase()) {
    return { ok: false, status: 401, error: 'WrongSigner', message: 'The signature was made by a different wallet than the one named.' };
  }

  // Spend it atomically: two requests with the same valid signature cannot both succeed.
  const spent = await query<{ nonce: string }>(
    `UPDATE wallet_challenges SET used_at = NOW() WHERE nonce = $1 AND tenant_id = $2 AND used_at IS NULL RETURNING nonce`,
    [nonce, tenantId],
  );
  if (spent.length === 0) return { ok: false, status: 409, error: 'AlreadyUsed', message: 'That challenge was already used. Start again.' };
  return { ok: true, address: row.address, agentId: row.agent_id };
}

export async function recordWalletBinding(tenantId: string, address: string, agentId: string, provedBy: string): Promise<void> {
  await query(
    `INSERT INTO wallet_bindings (tenant_id, address, agent_id, proved_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tenant_id, address, agent_id) DO UPDATE SET proved_at = NOW(), proved_by = EXCLUDED.proved_by`,
    [tenantId, address, agentId, provedBy],
  );
}

/** The self-certifying identity for a proven wallet: did:forge:0x<checksummed address>. */
export function didForWallet(address: string): string {
  return `did:forge:${getAddress(address)}`;
}
