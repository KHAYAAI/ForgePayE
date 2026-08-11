/**
 * Consent tokens for credit-report pulls.
 *
 * A hard inquiry exposes an agent's whole credit file to a lender. The only
 * gate on that was `consentToken: z.string().min(1)` — any non-empty string
 * passed, and the value was stored verbatim on the inquiry. `"x"` authorised a
 * full report. There was no issuer, no subject binding, no expiry, no
 * revocation, and nothing tying a token to the lender presenting it.
 *
 * For a credit bureau that is a legal control, not a feature: the inquiry
 * record is the evidence that the subject authorised the pull, and an
 * unverifiable string is not evidence.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Format
 *
 *   fpc1.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>
 *
 * A compact self-contained token rather than a JWT: the bureau is both issuer
 * and verifier, so asymmetric signing buys nothing here, and avoiding a JWT
 * dependency keeps this module copyable alongside `did.ts` and `hash.ts`.
 *
 * The payload binds every dimension that could otherwise be swapped:
 *
 *   sub      the agent whose file may be pulled
 *   aud      the lender allowed to pull it — a token leaked to a third party
 *            is useless to them
 *   purpose  must match the declared inquiry purpose, so consent for a credit
 *            application cannot be reused for employment screening
 *   exp/iat  validity window
 *   jti      single-use identifier, so one authorisation is one pull
 *   iss      the issuing bureau
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

const VERSION = 'fpc1';
const DEFAULT_TTL_SECONDS = 15 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MIN_PRODUCTION_SECRET_LENGTH = 32;
const DEV_SECRET = 'dev-consent-signing-secret';

export type ConsentPurpose =
  | 'credit_application'
  | 'account_review'
  | 'employment'
  | 'insurance';

export interface ConsentPayload {
  /** Agent whose credit file may be disclosed. */
  sub: string;
  /** Lender permitted to make the pull. */
  aud: string;
  purpose: ConsentPurpose;
  /** Unix seconds. */
  iat: number;
  exp: number;
  /** Single-use identifier. */
  jti: string;
  iss: string;
}

export type ConsentFailure =
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'subject_mismatch'
  | 'audience_mismatch'
  | 'purpose_mismatch'
  | 'already_used'
  | 'revoked';

export interface ConsentVerdict {
  valid: boolean;
  payload?: ConsentPayload;
  reason?: ConsentFailure;
  detail?: string;
}

// ── Signing secret ────────────────────────────────────────────────────────────

let cachedSecret: string | null = null;

/**
 * @throws in production when CONSENT_SIGNING_SECRET is missing, too short, or
 *         still the development value. A bureau that signs consent with a
 *         guessable key cannot evidence consent at all.
 */
export function getConsentSecret(): string {
  if (cachedSecret) return cachedSecret;

  const secret = process.env['CONSENT_SIGNING_SECRET'];
  if (process.env['NODE_ENV'] === 'production') {
    if (!secret) {
      throw new Error(
        'CONSENT_SIGNING_SECRET is not set. Consent tokens are the evidence that ' +
        'an agent authorised a credit pull — generate a secret with ' +
        '`openssl rand -hex 32` and supply it via Vault or AWS Secrets Manager.',
      );
    }
    if (secret === DEV_SECRET) {
      throw new Error('CONSENT_SIGNING_SECRET is the development value, which is public in this repository.');
    }
    if (secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
      throw new Error(
        `CONSENT_SIGNING_SECRET must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production.`,
      );
    }
  }

  cachedSecret = secret || DEV_SECRET;
  return cachedSecret;
}

/** Test helper. */
export function __resetConsentSecret(): void {
  cachedSecret = null;
}

// ── Single-use and revocation state ───────────────────────────────────────────
//
// In-memory, matching the rest of the service's read model. Both sets are
// bounded by expiry: a jti is only interesting until its token expires, after
// which the expiry check rejects it anyway.
//
// ⚠️ Per-process. With more than one replica a token could be spent once
// against each pod, so this must move to the shared Redis before the bureau
// scales past a single replica — the same constraint documented on
// forge-custody's replay cache.

const spentTokens = new Map<string, number>();   // jti → exp (unix seconds)
const revokedTokens = new Map<string, number>(); // jti → exp (unix seconds)

function prune(now: number): void {
  for (const [jti, exp] of spentTokens)   if (exp <= now) spentTokens.delete(jti);
  for (const [jti, exp] of revokedTokens) if (exp <= now) revokedTokens.delete(jti);
}

/** Revoke an outstanding token before it is spent or expires. */
export function revokeConsent(jti: string, exp: number): void {
  revokedTokens.set(jti, exp);
}

export function isSpent(jti: string): boolean {
  return spentTokens.has(jti);
}

/** Test helper — clears single-use and revocation state. */
export function __resetConsentState(): void {
  spentTokens.clear();
  revokedTokens.clear();
}

// ── Encoding ──────────────────────────────────────────────────────────────────

const b64url = (buf: Buffer) => buf.toString('base64url');

function sign(encodedPayload: string): string {
  return b64url(createHmac('sha256', getConsentSecret()).update(encodedPayload).digest());
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// ── Issue ─────────────────────────────────────────────────────────────────────

export interface IssueConsentInput {
  agentId: string;
  requestorId: string;
  purpose: ConsentPurpose;
  /** Seconds. Clamped to MAX_TTL_SECONDS; consent should be short-lived. */
  ttlSeconds?: number;
  issuer?: string;
}

export function issueConsent(input: IssueConsentInput): { token: string; payload: ConsentPayload } {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(1, input.ttlSeconds ?? DEFAULT_TTL_SECONDS), MAX_TTL_SECONDS);

  const payload: ConsentPayload = {
    sub:     input.agentId,
    aud:     input.requestorId,
    purpose: input.purpose,
    iat:     now,
    exp:     now + ttl,
    jti:     randomUUID(),
    iss:     input.issuer ?? 'forge-credit-bureau',
  };

  const encoded = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return { token: `${VERSION}.${encoded}.${sign(encoded)}`, payload };
}

// ── Verify ────────────────────────────────────────────────────────────────────

export interface VerifyConsentInput {
  token: string;
  /** The pull actually being attempted — every field must match the token. */
  agentId: string;
  requestorId: string;
  purpose: ConsentPurpose;
  /** Consume the token on success, making it single-use. */
  consume?: boolean;
}

/**
 * Verify a consent token against the pull being attempted.
 *
 * Never throws; a caller gets a structured verdict so the refusal reason can be
 * surfaced and audited.
 */
export function verifyConsent(input: VerifyConsentInput): ConsentVerdict {
  const fail = (reason: ConsentFailure, detail: string): ConsentVerdict => ({ valid: false, reason, detail });

  if (typeof input.token !== 'string' || !input.token) {
    return fail('malformed', 'No consent token supplied.');
  }

  const parts = input.token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return fail('malformed', `Expected a ${VERSION} consent token of the form ${VERSION}.<payload>.<signature>.`);
  }

  const [, encoded, signature] = parts as [string, string, string];

  // Signature first: never parse or act on an unauthenticated payload.
  if (!safeEqual(sign(encoded), signature)) {
    return fail('bad_signature', 'Consent token signature does not verify.');
  }

  let payload: ConsentPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ConsentPayload;
  } catch {
    return fail('malformed', 'Consent token payload is not valid JSON.');
  }
  if (!payload?.sub || !payload.aud || !payload.jti || !payload.exp) {
    return fail('malformed', 'Consent token payload is missing required claims.');
  }

  const now = Math.floor(Date.now() / 1000);
  prune(now);

  if (payload.exp <= now)  return fail('expired', `Consent expired at ${new Date(payload.exp * 1000).toISOString()}.`);
  if (payload.iat && payload.iat > now + 60) {
    return fail('not_yet_valid', 'Consent token is issued in the future.');
  }

  if (payload.sub !== input.agentId) {
    return fail('subject_mismatch', `Consent authorises a pull on ${payload.sub}, not ${input.agentId}.`);
  }
  if (payload.aud !== input.requestorId) {
    return fail('audience_mismatch', `Consent was issued to ${payload.aud}, not ${input.requestorId}.`);
  }
  if (payload.purpose !== input.purpose) {
    return fail('purpose_mismatch', `Consent covers "${payload.purpose}", not "${input.purpose}".`);
  }

  if (revokedTokens.has(payload.jti)) {
    return fail('revoked', 'Consent was revoked by the agent operator.');
  }
  if (spentTokens.has(payload.jti)) {
    return fail('already_used', 'Consent tokens are single-use; this one has already authorised a pull.');
  }

  if (input.consume !== false) {
    spentTokens.set(payload.jti, payload.exp);
  }

  return { valid: true, payload };
}
