/**
 * Custody attestations: a signed statement from FORGE custody about how one agent has behaved with its money, used to give Mode 2 the
 * two measurements public chain data cannot: how often its payments succeed, and how often it stayed within its budget.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why an attestation, and not a feed from custody
 *
 * Custody's own admin route returns an agent's lifetime counts, but it sits behind a user login that expires hourly, it carries no
 * machine credential, and it does not say which wallet the agent pays from. Reading it from here would need a standing credential
 * on the bureau and would leave one question open: is this custody agent really this bureau agent? Anyone could link an agent
 * with a spotless record to their own.
 *
 * So custody signs a short statement about one agent, naming the address of the key it pays from. The agent's operator takes it
 * from custody and gives it to the bureau. That act is their consent. The bureau checks:
 *
 *   - the signature, against custody's published attestation key(s) (more than one, so the key can be rotated);
 *   - that the key address in it is the wallet this bureau agent proved it controls, so a record cannot be borrowed;
 *   - that it is fresh, has a short validity, and is not from the future;
 *   - that it is internally consistent (counts add up);
 *   - on a later submission, that it is newer than the last and the lifetime counts did not go DOWN, so an older, better-looking
 *     statement cannot be replayed over a worse one.
 *
 * The bureau holds no credential for custody and makes no call to it. An attestation that is not renewed expires, and its signals
 * stop counting: an unknown is left out of the score, never assumed good.
 *
 * Contract with custody (to be implemented there; see docs/launch/11-custody-backend.md):
 *   envelope = { payload: "<JSON text>", signature: "<base64 ed25519 signature over the UTF-8 bytes of payload>" }
 *   payload  = { version: 1, issuer: "forge-custody", issuedAt, expiresAt, custodyCustomerId, agentId, keyAddress, agentStatus,
 *                record: { transfers, released, refused, refusalsByReason }, subject? }
 * The signed text is carried as a string so there is no canonicalisation to disagree about.
 */

import { createPublicKey, verify } from 'node:crypto';
import type { AgentCreditProfile } from './types';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CustodyRecord {
  /** Payments that were signed and broadcast. */
  transfers: number;
  /** Payments that passed every limit and were then abandoned (signing or broadcast failed); nothing was paid. */
  released: number;
  /** Attempts custody refused, for any reason. */
  refused: number;
  /** Refusals grouped by the reason text before its first colon, e.g. "over daily budget". */
  refusalsByReason: Record<string, number>;
}

export interface AttestationPayload {
  version: 1;
  issuer: 'forge-custody';
  issuedAt: string;
  expiresAt: string;
  custodyCustomerId: string;
  agentId: string;
  keyAddress: string;
  agentStatus: 'active' | 'revoked';
  record: CustodyRecord;
  /** If present, the bureau agent (id or DID) this statement was issued for. */
  subject?: string;
}

export interface AttestationEnvelope { payload: string; signature: string }

export interface StoredAttestation extends AttestationPayload {
  /** Who submitted it, i.e. who consented. */
  submittedBy: string;
  consentRef?: string;
  receivedAt: string;
  /** The bureau agent it is stored against. */
  bureauAgentId: string;
}

// ── Configuration ────────────────────────────────────────────────────────────

const SPKI_ED25519_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const MAX_PAYLOAD_BYTES = 16 * 1024;
const MAX_VALIDITY_MS = 14 * 24 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_REASONS = 50;

/** Custody's attestation public keys: comma-separated base64 raw 32-byte ed25519 keys. Empty means the feature is off. */
export function attestationKeys(env: NodeJS.ProcessEnv = process.env): Buffer[] {
  return (env['CUSTODY_ATTESTATION_PUBLIC_KEYS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean).map((b64) => {
    const raw = Buffer.from(b64, 'base64');
    if (raw.length !== 32) throw new Error('CUSTODY_ATTESTATION_PUBLIC_KEYS must be comma-separated base64 raw 32-byte ed25519 public keys');
    return raw;
  });
}

export function attestationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return attestationKeys(env).length > 0;
}

/** Fewest attempts before a rate is meaningful. One clean payment is not a 100% record. */
export function minAttempts(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env['CUSTODY_ATTESTATION_MIN_ATTEMPTS']);
  return Number.isInteger(n) && n >= 1 ? n : 10;
}

// ── Verification ─────────────────────────────────────────────────────────────

export type VerifyCode =
  | 'unconfigured' | 'malformed' | 'bad_signature' | 'invalid_payload' | 'expired' | 'not_yet_valid' | 'validity_too_long'
  | 'agent_has_no_evm_address' | 'wallet_mismatch' | 'subject_mismatch';

export type VerifyResult =
  | { ok: true; payload: AttestationPayload }
  | { ok: false; code: VerifyCode; message: string };

const fail = (code: VerifyCode, message: string): VerifyResult => ({ ok: false, code, message });
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function signatureValid(text: string, signatureB64: string, keys: Buffer[]): boolean {
  const sig = Buffer.from(signatureB64, 'base64');
  if (sig.length !== 64) return false;
  const data = Buffer.from(text, 'utf8');
  for (const raw of keys) {
    try {
      const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519_PREFIX, raw]), format: 'der', type: 'spki' });
      if (verify(null, data, key, sig)) return true;
    } catch { /* try the next key */ }
  }
  return false;
}

export function parsePayload(text: string): AttestationPayload | null {
  let p: any;
  try { p = JSON.parse(text); } catch { return null; }
  if (!p || typeof p !== 'object' || p.version !== 1 || p.issuer !== 'forge-custody') return null;
  if (typeof p.issuedAt !== 'string' || !ISO.test(p.issuedAt) || typeof p.expiresAt !== 'string' || !ISO.test(p.expiresAt)) return null;
  if (typeof p.custodyCustomerId !== 'string' || !p.custodyCustomerId || p.custodyCustomerId.length > 100) return null;
  if (typeof p.agentId !== 'string' || !p.agentId || p.agentId.length > 100) return null;
  if (typeof p.keyAddress !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(p.keyAddress)) return null;
  if (p.agentStatus !== 'active' && p.agentStatus !== 'revoked') return null;
  if (p.subject !== undefined && (typeof p.subject !== 'string' || p.subject.length > 200)) return null;
  const r = p.record;
  if (!r || typeof r !== 'object' || !isCount(r.transfers) || !isCount(r.released) || !isCount(r.refused)) return null;
  const reasons = r.refusalsByReason;
  if (!reasons || typeof reasons !== 'object' || Array.isArray(reasons)) return null;
  const entries = Object.entries(reasons);
  if (entries.length > MAX_REASONS) return null;
  let sum = 0;
  for (const [k, v] of entries) {
    if (k.length === 0 || k.length > 100 || !isCount(v)) return null;
    sum += v;
  }
  if (sum !== r.refused) return null;                      // the groups must add up to the total
  return {
    version: 1, issuer: 'forge-custody', issuedAt: p.issuedAt, expiresAt: p.expiresAt, custodyCustomerId: p.custodyCustomerId,
    agentId: p.agentId, keyAddress: p.keyAddress, agentStatus: p.agentStatus,
    record: { transfers: r.transfers, released: r.released, refused: r.refused, refusalsByReason: { ...reasons } },
    ...(p.subject !== undefined ? { subject: p.subject } : {}),
  };
}

export function verifyAttestation(
  envelope: unknown, profile: AgentCreditProfile, now: number = Date.now(), env: NodeJS.ProcessEnv = process.env,
): VerifyResult {
  const keys = attestationKeys(env);
  if (keys.length === 0) return fail('unconfigured', 'Custody attestations are not enabled on this bureau (no attestation keys are configured).');

  const e = envelope as Partial<AttestationEnvelope> | null;
  if (!e || typeof e.payload !== 'string' || typeof e.signature !== 'string') return fail('malformed', 'Expected { payload, signature } as strings.');
  if (Buffer.byteLength(e.payload, 'utf8') > MAX_PAYLOAD_BYTES) return fail('malformed', 'The attestation is too large.');

  // Signature first: nothing inside an unsigned payload is believed or even described back to the caller.
  if (!signatureValid(e.payload, e.signature, keys)) return fail('bad_signature', 'The signature does not match any configured custody attestation key.');

  const p = parsePayload(e.payload);
  if (!p) return fail('invalid_payload', 'The attestation is signed but its contents are not in the expected form.');

  const issued = Date.parse(p.issuedAt); const expires = Date.parse(p.expiresAt);
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || expires <= issued) return fail('invalid_payload', 'The attestation has an invalid validity period.');
  if (issued > now + CLOCK_SKEW_MS) return fail('not_yet_valid', 'The attestation is dated in the future.');
  if (expires <= now) return fail('expired', 'The attestation has expired. Ask custody for a fresh one.');
  if (expires - issued > MAX_VALIDITY_MS) return fail('validity_too_long', 'The attestation is valid for longer than 14 days, which the bureau does not accept.');

  if (!profile.evmAddress) return fail('agent_has_no_evm_address', 'This agent has no proven EVM wallet, so a custody record cannot be matched to it.');
  if (p.keyAddress.toLowerCase() !== profile.evmAddress.toLowerCase()) {
    return fail('wallet_mismatch', 'The custody key in the attestation is not this agent\'s wallet.');
  }
  if (p.subject !== undefined && p.subject !== profile.agentId && p.subject !== profile.did) {
    return fail('subject_mismatch', 'The attestation was issued for a different agent.');
  }
  return { ok: true, payload: p };
}

// ── Submission rules against what is already stored ──────────────────────────

export type SubmitRefusal = 'not_newer' | 'different_custody_agent' | 'record_went_backwards';

/**
 * A new statement may only extend what is stored. Returns why it must be refused, or null.
 *
 * Counts are lifetime totals, so they can only grow. A statement with smaller totals, or an older or equal date, is either a replay
 * of a more flattering past or a mistake; either way it must not replace the current one. Pointing a bureau agent at a different
 * custody agent needs an explicit revoke first, so a record cannot be swapped quietly.
 */
export function refuseIfRegressive(prior: StoredAttestation | undefined, next: AttestationPayload): { code: SubmitRefusal; message: string } | null {
  if (!prior) return null;
  if (prior.custodyCustomerId !== next.custodyCustomerId || prior.agentId !== next.agentId || prior.keyAddress.toLowerCase() !== next.keyAddress.toLowerCase()) {
    return { code: 'different_custody_agent', message: 'This agent is already linked to a different custody agent. Revoke the existing link first.' };
  }
  if (Date.parse(next.issuedAt) <= Date.parse(prior.issuedAt)) {
    return { code: 'not_newer', message: 'This attestation is not newer than the one already held.' };
  }
  const a = prior.record; const b = next.record;
  if (b.transfers < a.transfers || b.released < a.released || b.refused < a.refused) {
    return { code: 'record_went_backwards', message: 'The lifetime counts in this attestation are lower than in the one already held, which cannot happen to a real record.' };
  }
  return null;
}

// ── What Mode 2 gets from it ─────────────────────────────────────────────────

const BUDGET_REASON = /^over (per-transfer limit|daily budget)$/;

export interface CustodySignals {
  /** Share of payments that went through once they were allowed to be attempted, in basis points. Null if too few to say. */
  successRateBps: number | null;
  /** Share of attempts that stayed within the agent's budget (1 = never over). Null if too few to say. */
  budgetComplianceRate: number | null;
  attempts: number;
  executed: number;
  overBudgetRefusals: number;
  otherRefusals: number;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Turn a stored record into the two Mode 2 inputs, or null when the attestation has expired.
 *
 * "Executed" is a payment that passed every limit and was then attempted (it went through, or was abandoned); success is the share
 * that went through. A refusal is not a failed payment, because nothing was attempted, so it does not lower success: it is measured
 * separately, as budget compliance, and only the two budget reasons count against it. A refusal for an address or token that is not
 * allowed is a different matter and is reported but not scored here. Below the minimum number of attempts a rate is left unknown.
 */
export function custodySignals(a: StoredAttestation, now: number = Date.now(), min: number = minAttempts()): CustodySignals | null {
  if (Date.parse(a.expiresAt) <= now) return null;
  const { transfers, released, refused, refusalsByReason } = a.record;
  const executed = transfers + released;
  const attempts = executed + refused;
  let over = 0;
  for (const [reason, n] of Object.entries(refusalsByReason)) if (BUDGET_REASON.test(reason)) over += n;
  return {
    successRateBps: executed >= min ? Math.round((transfers / executed) * 10_000) : null,
    budgetComplianceRate: attempts >= min ? Math.round((1 - over / attempts) * 10_000) / 10_000 : null,
    attempts, executed, overBudgetRefusals: over, otherRefusals: refused - over,
    issuedAt: a.issuedAt, expiresAt: a.expiresAt,
  };
}

// ── Store, with write-through persistence ────────────────────────────────────

const stored = new Map<string, StoredAttestation>();

export interface AttestationPersistence {
  save(a: StoredAttestation): Promise<void>;
  remove(bureauAgentId: string): Promise<void>;
}
let persistence: AttestationPersistence | null = null;
export function setAttestationPersistence(p: AttestationPersistence | null): void { persistence = p; }

export function hydrateAttestations(rows: StoredAttestation[]): void {
  stored.clear();
  for (const r of rows) stored.set(r.bureauAgentId, r);
}

export function resetAttestations(): void { stored.clear(); }
export function getAttestation(bureauAgentId: string): StoredAttestation | undefined { return stored.get(bureauAgentId); }

export function saveAttestation(a: StoredAttestation): void {
  stored.set(a.bureauAgentId, a);
  void persistence?.save(a);
}

/** Withdraw consent: the stored statement and everything derived from it are erased. */
export function revokeAttestation(bureauAgentId: string): boolean {
  const had = stored.delete(bureauAgentId);
  if (had) void persistence?.remove(bureauAgentId);
  return had;
}

/** What may be shown about a link: no raw payload, no signature. */
export function attestationSummary(a: StoredAttestation, now: number = Date.now()) {
  const sig = custodySignals(a, now);
  return {
    agentId: a.bureauAgentId,
    custodyAgentId: a.agentId,
    keyAddress: a.keyAddress,
    agentStatus: a.agentStatus,
    issuedAt: a.issuedAt,
    expiresAt: a.expiresAt,
    expired: Date.parse(a.expiresAt) <= now,
    receivedAt: a.receivedAt,
    submittedBy: a.submittedBy,
    ...(a.consentRef ? { consentRef: a.consentRef } : {}),
    record: a.record,
    signals: sig,
  };
}
