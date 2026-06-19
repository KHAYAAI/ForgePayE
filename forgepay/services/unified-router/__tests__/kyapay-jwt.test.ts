/**
 * Tests for KYAPay JWT utilities.
 *
 * verifyKYAPayToken makes a remote JWKS fetch — those cases require a live
 * issuer and are handled in integration tests.
 *
 * This file tests:
 *   - extractAgentContext claim mapping (pure function, no I/O)
 *   - Pre-verification guards (format, alg, trusted-issuer list) that fail
 *     before any network call is made
 */

import { describe, it, expect } from 'vitest';
import { extractAgentContext, verifyKYAPayToken } from '../src/lib/kyapay-jwt.js';
import type { KYAPayClaims } from '../src/lib/kyapay-jwt.js';

// ── extractAgentContext ────────────────────────────────────────────────────────

describe('extractAgentContext', () => {
  const baseClaims: KYAPayClaims = {
    sub: 'agent-abc-123',
    iss: 'https://skyfire.xyz',
    aud: 'mer_01J000FAKEMERCHANT',
    exp: Math.floor(Date.now() / 1000) + 300,
    iat: Math.floor(Date.now() / 1000),
    jti: 'jti-test-001',
    value: '99.00',
    cur:   'USD',
    sps:   'USDC',
    spr:   'polygon',
    rec:   'mer_target_001',
    bid: {
      kycVerified:  true,
      businessName: 'Acme AI Corp',
      jurisdiction: 'US',
    },
    fp_reputation:  750,
    fp_trust_level: 'verified',
  };

  it('maps rec claim to merchantId when present', () => {
    const ctx = extractAgentContext(baseClaims);
    expect(ctx.merchantId).toBe('mer_target_001');
  });

  it('falls back to aud when rec is absent', () => {
    const { rec: _rec, ...noRec } = baseClaims;
    const ctx = extractAgentContext(noRec as KYAPayClaims);
    expect(ctx.merchantId).toBe('mer_01J000FAKEMERCHANT');
  });

  it('uses first element of aud array when aud is an array', () => {
    const claims = { ...baseClaims, aud: ['mer_first', 'mer_second'], rec: undefined };
    const ctx = extractAgentContext(claims as KYAPayClaims);
    expect(ctx.merchantId).toBe('mer_first');
  });

  it('maps all expected fields from a full KYA-PAY token', () => {
    const ctx = extractAgentContext(baseClaims);
    expect(ctx.kyapaySubject).toBe('agent-abc-123');
    expect(ctx.kyapayIssuer).toBe('https://skyfire.xyz');
    expect(ctx.spendLimitValue).toBe('99.00');
    expect(ctx.spendLimitCurrency).toBe('USD');
    expect(ctx.settlementAsset).toBe('USDC');
    expect(ctx.settlementChain).toBe('polygon');
    expect(ctx.kycVerified).toBe(true);
    expect(ctx.businessName).toBe('Acme AI Corp');
    expect(ctx.jurisdiction).toBe('US');
    expect(ctx.jti).toBe('jti-test-001');
  });

  it('defaults kycVerified to false when bid is absent', () => {
    const { bid: _bid, ...noBid } = baseClaims;
    const ctx = extractAgentContext(noBid as KYAPayClaims);
    expect(ctx.kycVerified).toBe(false);
  });

  it('handles minimal token with no payment claims', () => {
    const minimal: KYAPayClaims = {
      sub: 'agent-minimal',
      iss: 'https://skyfire.xyz',
      aud: 'mer_x',
      exp: 9999999999,
      iat: 1000000000,
    };
    const ctx = extractAgentContext(minimal);
    expect(ctx.spendLimitValue).toBeUndefined();
    expect(ctx.settlementAsset).toBeUndefined();
    expect(ctx.settlementChain).toBeUndefined();
    expect(ctx.businessName).toBeUndefined();
    expect(ctx.jti).toBeUndefined();
    expect(ctx.kycVerified).toBe(false);
  });
});

// ── verifyKYAPayToken — pre-verification guards ────────────────────────────────
// These checks fire before any JWKS network fetch.

describe('verifyKYAPayToken — pre-verification guards', () => {
  const TRUSTED = ['https://skyfire.xyz'];

  it('rejects a string with more than 3 dot-separated parts', async () => {
    await expect(verifyKYAPayToken('not.a.jwt.extra', { trustedIssuers: TRUSTED }))
      .rejects.toThrow('Invalid JWT format');
  });

  it('rejects a JWT with alg != ES256', async () => {
    const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://skyfire.xyz', sub: 'x', aud: 'a', exp: 9999999999, iat: 1,
    })).toString('base64url');
    await expect(verifyKYAPayToken(`${header}.${payload}.fakesig`, { trustedIssuers: TRUSTED }))
      .rejects.toThrow('ES256');
  });

  it('rejects a JWT with no iss claim', async () => {
    const header  = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'x', aud: 'a', exp: 9999999999, iat: 1 })).toString('base64url');
    await expect(verifyKYAPayToken(`${header}.${payload}.fakesig`, { trustedIssuers: TRUSTED }))
      .rejects.toThrow('missing iss');
  });

  it('rejects a JWT from an untrusted issuer', async () => {
    const header  = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      iss: 'https://evil.example.com', sub: 'x', aud: 'a', exp: 9999999999, iat: 1,
    })).toString('base64url');
    await expect(verifyKYAPayToken(`${header}.${payload}.fakesig`, { trustedIssuers: TRUSTED }))
      .rejects.toThrow('Untrusted issuer');
  });
});
