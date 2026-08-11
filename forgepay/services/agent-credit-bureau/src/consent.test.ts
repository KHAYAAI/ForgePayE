/**
 * Consent tokens.
 *
 * The regression these guard: `consentToken: z.string().min(1)` meant the
 * string "x" authorised a full credit-file disclosure, and the value was stored
 * verbatim on the inquiry. Every binding below is a dimension an attacker could
 * otherwise swap — lender, purpose, subject — while still presenting a token
 * the bureau accepted.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ConsentPurpose } from './consent';
import {
  issueConsent,
  verifyConsent,
  revokeConsent,
  isSpent,
  __resetConsentState,
} from './consent';

interface Pull { agentId: string; requestorId: string; purpose: ConsentPurpose }

const BASE: Pull = { agentId: 'agent_prime_001', requestorId: 'lender_x', purpose: 'credit_application' };
const pull = (over: Partial<Pull> = {}): Pull => ({ ...BASE, ...over });

beforeEach(() => {
  __resetConsentState();
});

describe('issue', () => {
  it('produces a three-part fpc1 token bound to the pull', () => {
    const { token, payload } = issueConsent(BASE);
    expect(token.split('.')).toHaveLength(3);
    expect(token.startsWith('fpc1.')).toBe(true);
    expect(payload.sub).toBe(BASE.agentId);
    expect(payload.aud).toBe(BASE.requestorId);
    expect(payload.purpose).toBe(BASE.purpose);
    expect(payload.exp).toBeGreaterThan(payload.iat);
  });

  it('mints a distinct jti per issuance', () => {
    expect(issueConsent(BASE).payload.jti).not.toBe(issueConsent(BASE).payload.jti);
  });

  it('clamps an absurd TTL rather than honouring it', () => {
    const { payload } = issueConsent({ ...BASE, ttlSeconds: 999_999_999 });
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(86_400);
  });
});

describe('verify — the happy path', () => {
  it('accepts a token that matches the pull', () => {
    const { token } = issueConsent(BASE);
    const v = verifyConsent({ token, ...pull() });
    expect(v.valid).toBe(true);
    expect(v.payload?.sub).toBe(BASE.agentId);
  });

  it('can check without consuming, for a dry run', () => {
    const { token, payload } = issueConsent(BASE);
    expect(verifyConsent({ token, ...pull(), consume: false }).valid).toBe(true);
    expect(isSpent(payload.jti)).toBe(false);
    // Still usable for the real pull.
    expect(verifyConsent({ token, ...pull() }).valid).toBe(true);
  });
});

describe('verify — bindings', () => {
  it('refuses a token presented by a different lender', () => {
    const { token } = issueConsent(BASE);
    const v = verifyConsent({ token, ...pull({ requestorId: 'lender_evil' }) });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('audience_mismatch');
  });

  it('refuses a token reused for a different purpose', () => {
    const { token } = issueConsent(BASE);
    const v = verifyConsent({ token, ...pull({ purpose: 'employment' }) });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('purpose_mismatch');
  });

  it('refuses a token pointed at a different agent', () => {
    const { token } = issueConsent(BASE);
    const v = verifyConsent({ token, ...pull({ agentId: 'agent_prime_002' }) });
    expect(v.valid).toBe(false);
    expect(v.reason).toBe('subject_mismatch');
  });

  it('does not consume the token on a failed binding check', () => {
    const { token, payload } = issueConsent(BASE);
    verifyConsent({ token, ...pull({ requestorId: 'lender_evil' }) });
    expect(isSpent(payload.jti)).toBe(false);
    // The legitimate lender can still use it.
    expect(verifyConsent({ token, ...pull() }).valid).toBe(true);
  });
});

describe('verify — integrity', () => {
  it('refuses a tampered signature', () => {
    const { token } = issueConsent(BASE);
    const tampered = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(verifyConsent({ token: tampered, ...pull() }).reason).toBe('bad_signature');
  });

  it('refuses a payload edited to widen its scope', () => {
    const { token } = issueConsent(BASE);
    const [v, encoded, sig] = token.split('.');
    const payload = JSON.parse(Buffer.from(encoded!, 'base64url').toString('utf8'));
    payload.aud = 'lender_evil';
    const forged = [v, Buffer.from(JSON.stringify(payload)).toString('base64url'), sig].join('.');

    // Signature is checked before the payload is trusted, so this is a
    // signature failure rather than an audience mismatch.
    expect(verifyConsent({ token: forged, ...pull({ requestorId: 'lender_evil' }) }).reason).toBe('bad_signature');
  });

  it('refuses malformed input without throwing', () => {
    for (const bad of ['x', '', 'fpc1.only-two', 'nope.a.b', 'fpc1.!!!.!!!']) {
      const v = verifyConsent({ token: bad, ...pull() });
      expect(v.valid).toBe(false);
      expect(['malformed', 'bad_signature']).toContain(v.reason);
    }
  });
});

describe('single use', () => {
  it('authorises exactly one pull', () => {
    const { token } = issueConsent(BASE);
    expect(verifyConsent({ token, ...pull() }).valid).toBe(true);

    const replay = verifyConsent({ token, ...pull() });
    expect(replay.valid).toBe(false);
    expect(replay.reason).toBe('already_used');
  });
});

describe('expiry and revocation', () => {
  it('refuses an expired token', () => {
    const { token } = issueConsent({ ...BASE, ttlSeconds: 1 });
    // Move the clock past expiry rather than sleeping.
    const realNow = Date.now;
    Date.now = () => realNow() + 5_000;
    try {
      expect(verifyConsent({ token, ...pull() }).reason).toBe('expired');
    } finally {
      Date.now = realNow;
    }
  });

  it('refuses a revoked token even though it is otherwise valid', () => {
    const { token, payload } = issueConsent(BASE);
    revokeConsent(payload.jti, payload.exp);
    expect(verifyConsent({ token, ...pull() }).reason).toBe('revoked');
  });

  it('checks revocation before spending, so a revoked token is not consumed', () => {
    const { token, payload } = issueConsent(BASE);
    revokeConsent(payload.jti, payload.exp);
    verifyConsent({ token, ...pull() });
    expect(isSpent(payload.jti)).toBe(false);
  });
});
