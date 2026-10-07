import { beforeEach, describe, expect, it, vi } from 'vitest';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';

interface Row { nonce: string; tenant_id: string; address: string; agent_id: string; message: string; expires_at: string; used_at: string | null }
const rows = new Map<string, Row>();

// A small stand-in for the two statements the module runs, with the atomic single-use update behaving like Postgres.
vi.mock('./db', () => ({
  query: vi.fn(async (sql: string, p: unknown[]) => {
    if (/INSERT INTO wallet_challenges/.test(sql)) {
      const [nonce, tenant_id, address, agent_id, message, expires_at] = p as string[];
      rows.set(nonce!, { nonce: nonce!, tenant_id: tenant_id!, address: address!, agent_id: agent_id!, message: message!, expires_at: expires_at!, used_at: null });
      return [];
    }
    if (/UPDATE wallet_challenges SET used_at/.test(sql)) {
      const [nonce, tenant] = p as string[];
      const r = rows.get(nonce!);
      if (r && r.tenant_id === tenant && !r.used_at) { r.used_at = new Date().toISOString(); return [{ nonce: r.nonce }]; }
      return [];
    }
    return [];
  }),
  queryOne: vi.fn(async (_sql: string, p: unknown[]) => {
    const [nonce, tenant] = p as string[];
    const r = rows.get(nonce!);
    return r && r.tenant_id === tenant ? { ...r } : null;
  }),
}));

import { CHALLENGE_TTL_MS, createWalletChallenge, didForWallet, verifyWalletChallenge, walletChain } from './wallet-binding';
import { newSolanaWallet } from './testing/solana-wallet';

const key = generatePrivateKey();
const wallet = privateKeyToAccount(key);
const other = privateKeyToAccount(generatePrivateKey());

beforeEach(() => rows.clear());

async function challenge(address = wallet.address, agentId = 'agent_1', tenantId = 'ws_a', now = Date.now()) {
  const c = await createWalletChallenge({ tenantId, address, agentId }, now);
  if (!c.ok) throw new Error('challenge failed: ' + c.message);
  return c;
}

describe('creating a challenge', () => {
  it('names the address, agent, workspace and nonce, and expires in ten minutes', async () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    const c = await challenge(wallet.address.toLowerCase() as `0x${string}`, 'agent_1', 'ws_a', now);
    expect(c.address).toBe(wallet.address);                         // checksummed even if the caller sent lower case
    expect(c.message).toContain(`Address: ${wallet.address}`);
    expect(c.message).toContain('Agent: agent_1');
    expect(c.message).toContain('Workspace: ws_a');
    expect(c.message).toContain(`Nonce: ${c.nonce}`);
    expect(c.message).toMatch(/does not move funds/);
    expect(Date.parse(c.expiresAt) - now).toBe(CHALLENGE_TTL_MS);
  });
  it('rejects a bad address or agent id before storing anything', async () => {
    for (const address of ['', 'not-an-address', '0x123']) {
      expect((await createWalletChallenge({ tenantId: 'ws_a', address, agentId: 'a' })).ok).toBe(false);
    }
    expect((await createWalletChallenge({ tenantId: 'ws_a', address: wallet.address, agentId: 'has space' })).ok).toBe(false);
    expect((await createWalletChallenge({ tenantId: 'ws_a', address: wallet.address, agentId: '' })).ok).toBe(false);
    expect(rows.size).toBe(0);
  });
});

describe('verifying a signature', () => {
  it('accepts the wallet\'s own signature and returns the proven address and agent', async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message });
    const v = await verifyWalletChallenge('ws_a', c.nonce, signature);
    expect(v).toMatchObject({ ok: true, address: wallet.address, agentId: 'agent_1' });
  });

  it('refuses a signature from a different wallet than the one named', async () => {
    const c = await challenge();
    const signature = await other.signMessage({ message: c.message });
    const v = await verifyWalletChallenge('ws_a', c.nonce, signature);
    expect(v).toMatchObject({ ok: false, status: 401, error: 'WrongSigner' });
  });

  it('refuses a signature over different text (the message cannot be swapped)', async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message.replace('agent_1', 'agent_evil') });
    expect(await verifyWalletChallenge('ws_a', c.nonce, signature)).toMatchObject({ ok: false, error: 'WrongSigner' });
  });

  it('is single-use: the same valid signature cannot be replayed', async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message });
    expect((await verifyWalletChallenge('ws_a', c.nonce, signature)).ok).toBe(true);
    expect(await verifyWalletChallenge('ws_a', c.nonce, signature)).toMatchObject({ ok: false, status: 409, error: 'AlreadyUsed' });
  });

  it('two simultaneous requests with the same signature: exactly one succeeds', async () => {
    const c = await challenge();
    const signature = await wallet.signMessage({ message: c.message });
    const results = await Promise.all([verifyWalletChallenge('ws_a', c.nonce, signature), verifyWalletChallenge('ws_a', c.nonce, signature)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('refuses an expired challenge', async () => {
    const c = await challenge(wallet.address, 'agent_1', 'ws_a', Date.now() - CHALLENGE_TTL_MS - 1000);
    const signature = await wallet.signMessage({ message: c.message });
    expect(await verifyWalletChallenge('ws_a', c.nonce, signature)).toMatchObject({ ok: false, status: 410, error: 'Expired' });
  });

  it('does not reveal or accept another workspace\'s challenge', async () => {
    const c = await challenge(wallet.address, 'agent_1', 'ws_a');
    const signature = await wallet.signMessage({ message: c.message });
    expect(await verifyWalletChallenge('ws_b', c.nonce, signature)).toMatchObject({ ok: false, status: 404 });
    expect(rows.get(c.nonce)!.used_at).toBeNull(); // and it was not spent
  });

  it('rejects a malformed nonce or signature without touching the database', async () => {
    expect(await verifyWalletChallenge('ws_a', 'nope', '0x' + '1'.repeat(130))).toMatchObject({ ok: false, status: 400 });
    expect(await verifyWalletChallenge('ws_a', 'a'.repeat(32), '0x1234')).toMatchObject({ ok: false, status: 400 });
    expect(await verifyWalletChallenge('ws_a', 'a'.repeat(32), 'x'.repeat(132))).toMatchObject({ ok: false, status: 400 });
  });

  it('does not spend the challenge on a wrong signature, so the right wallet can still sign it', async () => {
    const c = await challenge();
    await verifyWalletChallenge('ws_a', c.nonce, await other.signMessage({ message: c.message }));
    expect(rows.get(c.nonce)!.used_at).toBeNull();
    expect((await verifyWalletChallenge('ws_a', c.nonce, await wallet.signMessage({ message: c.message }))).ok).toBe(true);
  });
});

describe('the identity of a proven wallet', () => {
  it('is did:forge: plus the checksummed address, which is what the bureau derives', () => {
    expect(didForWallet(wallet.address.toLowerCase())).toBe(`did:forge:${wallet.address}`);
  });
});

describe('a Solana wallet', () => {
  const sol = newSolanaWallet();
  const otherSol = newSolanaWallet();

  async function solChallenge(address = sol.address, tenantId = 'ws_a', now = Date.now()) {
    const c = await createWalletChallenge({ tenantId, address, agentId: 'agent_sol' }, now);
    if (!c.ok) throw new Error('challenge failed: ' + c.message);
    return c;
  }

  it('is told apart from an EVM wallet by its address alone', () => {
    expect(walletChain(sol.address)).toBe('solana');
    expect(walletChain(wallet.address)).toBe('evm');
    for (const bad of ['', 'nope', '0x123', null, undefined, 5]) expect(walletChain(bad)).toBeNull();
  });

  it('gets a challenge naming the address exactly as given (base58 is case-sensitive)', async () => {
    const c = await solChallenge();
    expect(c).toMatchObject({ chain: 'solana', address: sol.address });
    expect(c.message).toContain(`Address: ${sol.address}`);
  });

  it('is proven by an ed25519 signature over the challenge, returning the address, agent and chain', async () => {
    const c = await solChallenge();
    expect(await verifyWalletChallenge('ws_a', c.nonce, sol.signMessage(c.message))).toMatchObject({ ok: true, address: sol.address, agentId: 'agent_sol', chain: 'solana' });
  });

  it('refuses another wallet\'s signature and a signature over altered text, without spending the challenge', async () => {
    const c = await solChallenge();
    expect(await verifyWalletChallenge('ws_a', c.nonce, otherSol.signMessage(c.message))).toMatchObject({ ok: false, status: 401, error: 'WrongSigner' });
    expect(await verifyWalletChallenge('ws_a', c.nonce, sol.signMessage(c.message.replace('agent_sol', 'agent_evil')))).toMatchObject({ ok: false, error: 'WrongSigner' });
    expect(rows.get(c.nonce)!.used_at).toBeNull();
    expect((await verifyWalletChallenge('ws_a', c.nonce, sol.signMessage(c.message))).ok).toBe(true);
  });

  it('cannot be replayed, expires, and is not usable from another workspace', async () => {
    const c = await solChallenge();
    const sig = sol.signMessage(c.message);
    expect(await verifyWalletChallenge('ws_b', c.nonce, sig)).toMatchObject({ ok: false, status: 404 });
    expect((await verifyWalletChallenge('ws_a', c.nonce, sig)).ok).toBe(true);
    expect(await verifyWalletChallenge('ws_a', c.nonce, sig)).toMatchObject({ ok: false, status: 409, error: 'AlreadyUsed' });
    const old = await solChallenge(sol.address, 'ws_a', Date.now() - CHALLENGE_TTL_MS - 1000);
    expect(await verifyWalletChallenge('ws_a', old.nonce, sol.signMessage(old.message))).toMatchObject({ ok: false, status: 410 });
  });

  it('two simultaneous requests with the same valid signature: exactly one succeeds', async () => {
    const c = await solChallenge();
    const sig = sol.signMessage(c.message);
    const results = await Promise.all([verifyWalletChallenge('ws_a', c.nonce, sig), verifyWalletChallenge('ws_a', c.nonce, sig)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('the signature shape must match the wallet kind: a hex signature cannot prove a Solana wallet, nor base64 an EVM one', async () => {
    const c = await solChallenge();
    expect(await verifyWalletChallenge('ws_a', c.nonce, await wallet.signMessage({ message: c.message }))).toMatchObject({ ok: false, status: 400, error: 'BadSignature' });
    const e = await challenge();
    expect(await verifyWalletChallenge('ws_a', e.nonce, sol.signMessage(e.message))).toMatchObject({ ok: false, status: 400, error: 'BadSignature' });
    expect(rows.get(c.nonce)!.used_at).toBeNull();
    expect(rows.get(e.nonce)!.used_at).toBeNull();
  });

  it('gets the Solana form of the identity, which the bureau derives the same way', () => {
    expect(didForWallet(sol.address)).toBe(`did:forge:sol:${sol.address}`);
  });
});
