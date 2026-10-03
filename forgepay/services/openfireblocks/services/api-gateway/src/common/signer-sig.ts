import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign as edSign, verify as edVerify } from 'crypto';
import { canonicalJson, stripSeal } from './proposal-seal';

/**
 * Per-signer cryptographic approval.
 *
 * Until now a "vote" meant the console said so: the console authenticated the person and asserted who they were,
 * so whoever controlled the console (or held its secrets) could vote as anyone. Here each signer holds their own
 * Ed25519 key, off the console and off the gateway. A vote is valid only with that signer's signature over the exact
 * proposal (customer, kind, request, a digest of the payload, the proposal id and the decision), checked here against the
 * public key enrolled for them, and re-checked when the quorum is counted. A compromised console or gateway can no
 * longer manufacture an approval; it can only withhold or replay valid ones, and a replay is bound to one proposal and
 * one decision.
 *
 * Not built: a browser or hardware-token (WebAuthn) front end for signing. Today a signer signs with the CLI
 * (`scripts/signer-cli.ts`) or any tool that produces the same signature, and submits it with the vote.
 */

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export const VOTE_DOMAIN = 'forge-custody-vote-v1';
export const ENROLL_DOMAIN = 'forge-custody-enroll-v1';

/** Whether votes must be signed. On in production unless explicitly disabled; off elsewhere unless enabled. */
export function signaturesRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const v = env.CUSTODY_REQUIRE_SIGNER_SIGNATURES;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return env.NODE_ENV === 'production';
}

export function payloadDigest(customerId: string, kind: string, requestId: string | null | undefined, payload: Record<string, unknown>): string {
  return createHash('sha256').update(['d1', customerId, kind, requestId ?? '', canonicalJson(stripSeal(payload as Record<string, any>))].join('\n')).digest('hex');
}

export function voteMessage(customerId: string, proposalId: string, kind: string, digest: string, approve: boolean): string {
  return [VOTE_DOMAIN, customerId, proposalId, kind, digest, approve ? 'approve' : 'reject'].join('\n');
}

export function enrollMessage(customerId: string, email: string, publicKeyHex: string): string {
  return [ENROLL_DOMAIN, customerId, email.toLowerCase(), publicKeyHex.toLowerCase()].join('\n');
}

export function isPublicKeyHex(s: unknown): s is string {
  return typeof s === 'string' && /^[0-9a-fA-F]{64}$/.test(s);
}

export function verifySignature(publicKeyHex: string, message: string, signatureHex: string): boolean {
  try {
    if (!isPublicKeyHex(publicKeyHex) || !/^[0-9a-fA-F]{128}$/.test(signatureHex)) return false;
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' });
    return edVerify(null, Buffer.from(message), key, Buffer.from(signatureHex, 'hex'));
  } catch {
    return false;
  }
}

// ── Used by the signer's own tooling (scripts/signer-cli.ts) and by tests ──────────────────────────────

export function generateSignerKey(): { privateKeyHex: string; publicKeyHex: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(PKCS8_ED25519_PREFIX.length);
  const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(SPKI_ED25519_PREFIX.length);
  return { privateKeyHex: Buffer.from(priv).toString('hex'), publicKeyHex: Buffer.from(pub).toString('hex') };
}

export function signMessage(privateKeyHex: string, message: string): string {
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, Buffer.from(privateKeyHex, 'hex')]), format: 'der', type: 'pkcs8' });
  return edSign(null, Buffer.from(message), key).toString('hex');
}
