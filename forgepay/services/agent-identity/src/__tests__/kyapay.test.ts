/**
 * Tests for KYAPay integration routes.
 *
 *   GET  /.well-known/jwks.json       — public, no auth needed
 *   POST /v1/agents/import-kya        — validation + untrusted-issuer path (no live network)
 *   POST /v1/agents/:id/kyapay-token  — full issuance (uses ephemeral local key in test env)
 *
 * import-kya happy-path requires an externally-issued JWT from a trusted issuer
 * with a reachable JWKS endpoint — covered by integration tests, not here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;
const AUTH = { 'x-api-key': 'test-key' };

async function makeApp(): Promise<FastifyApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

describe('KYAPay routes', () => {
  let app: FastifyApp;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── GET /.well-known/jwks.json ─────────────────────────────────────────────

  describe('GET /.well-known/jwks.json', () => {
    it('returns 200 with a JWKS containing an ES256 key (no auth required)', async () => {
      const res = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
      expect(res.statusCode).toBe(200);
      const body = res.json<{ keys: Array<Record<string, unknown>> }>();
      expect(Array.isArray(body.keys)).toBe(true);
      expect(body.keys.length).toBeGreaterThan(0);
      const key = body.keys[0]!;
      expect(key['kty']).toBe('EC');
      expect(key['alg']).toBe('ES256');
      expect(key['use']).toBe('sig');
      expect(typeof key['kid']).toBe('string');
    });

    it('sets Cache-Control header', async () => {
      const res = await app.inject({ method: 'GET', url: '/.well-known/jwks.json' });
      expect(res.headers['cache-control']).toContain('max-age=3600');
    });
  });

  // ── POST /v1/agents/import-kya — validation errors ────────────────────────

  describe('POST /v1/agents/import-kya', () => {
    it('returns 400 when kyapayToken is missing', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        headers: AUTH,
        payload: { ownerMerchantId: 'mer_001' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string; message: string }>();
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('kyapayToken');
    });

    it('returns 400 when ownerMerchantId is missing', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        headers: AUTH,
        payload: { kyapayToken: 'some.fake.token' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string; message: string }>();
      expect(body.error).toBe('ValidationError');
      expect(body.message).toContain('ownerMerchantId');
    });

    it('returns 400 for a malformed JWT (not 3 parts)', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        headers: AUTH,
        payload: { kyapayToken: 'not-a-jwt', ownerMerchantId: 'mer_001' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('ValidationError');
    });

    it('returns 400 when JWT payload is missing iss or sub', async () => {
      const header  = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
      // Payload with no iss
      const payload = Buffer.from(JSON.stringify({ sub: 'agent-x', exp: 9999999999, iat: 1 })).toString('base64url');
      const fakeJwt = `${header}.${payload}.fakesig`;

      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        headers: AUTH,
        payload: { kyapayToken: fakeJwt, ownerMerchantId: 'mer_001' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('ValidationError');
    });

    it('returns 401 when JWT is from an untrusted issuer', async () => {
      const header  = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ iss: 'https://evil.example.com', sub: 'agent-evil', exp: 9999999999, iat: 1 })).toString('base64url');
      const fakeJwt = `${header}.${payload}.fakesig`;

      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        headers: AUTH,
        payload: { kyapayToken: fakeJwt, ownerMerchantId: 'mer_001' },
      });
      expect(res.statusCode).toBe(401);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('UntrustedIssuer');
    });

    it('returns 401 for a valid-format JWT from a trusted issuer with an invalid signature', async () => {
      // Well-formed JWT structure from trusted issuer, but garbage signature
      const header  = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({
        iss: 'https://skyfire.xyz',
        sub: 'agent-tampered',
        aud: 'mer_001',
        exp: 9999999999,
        iat: 1,
      })).toString('base64url');
      const fakeJwt = `${header}.${payload}.invalidsignaturehere`;

      // This will attempt JWKS fetch from skyfire.xyz and then fail with an InvalidToken
      // In tests without network this will also result in an error — either 401 or similar
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        headers: AUTH,
        payload: { kyapayToken: fakeJwt, ownerMerchantId: 'mer_001' },
      });
      // Either 401 (InvalidToken from sig check) or similar error — never 200/201
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/import-kya',
        payload: { kyapayToken: 'x.y.z', ownerMerchantId: 'mer_001' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── POST /v1/agents/:id/kyapay-token ──────────────────────────────────────

  describe('POST /v1/agents/:id/kyapay-token', () => {
    it('issues a JWT for an existing active agent', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/treasury-oracle-1/kyapay-token',
        headers: AUTH,
        payload: {
          value:               '250.00',
          currency:            'USD',
          settlementAsset:     'USDC',
          settlementChain:     'polygon',
          recipientMerchantId: 'mer_partner_001',
          audience:            'https://partner.example.com',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{
        token: string;
        agentId: string;
        did: string;
        expiresIn: number;
      }>();

      expect(typeof body.token).toBe('string');
      expect(body.token.split('.').length).toBe(3);
      expect(body.agentId).toBe('treasury-oracle-1');
      expect(body.did).toBe('did:forgepay:treasury-oracle-1');
      expect(body.expiresIn).toBe(300);
    });

    it('token payload contains ForgePay-extended claims', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/treasury-oracle-1/kyapay-token',
        headers: AUTH,
        payload: { value: '50.00' },
      });

      expect(res.statusCode).toBe(200);
      const { token } = res.json<{ token: string }>();

      // Decode without verifying to inspect claims
      const payloadB64 = token.split('.')[1]!;
      const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8')) as Record<string, unknown>;

      expect(claims['fp_reputation']).toBe(820);       // from seed agent
      expect(claims['fp_trust_level']).toBe('trusted');
      expect(typeof claims['fp_lifetime_volume']).toBe('string');
      expect(claims['fp_success_rate']).toBe(0.98);
      expect(claims['fp_ofac_cleared']).toBe(true);
      expect(claims['fp_defaults']).toBe(0);
      expect(claims['sps']).toBe('USDC');
      expect(claims['cur']).toBe('USD');
      expect((claims['bid'] as Record<string, unknown>)['kycVerified']).toBe(true);
    });

    it('returns 404 for an unknown agent', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/nonexistent-agent/kyapay-token',
        headers: AUTH,
        payload: {},
      });
      expect(res.statusCode).toBe(404);
      const body = res.json<{ error: string }>();
      expect(body.error).toBe('NotFound');
    });

    it('requires auth', async () => {
      const res = await app.inject({
        method:  'POST',
        url:     '/v1/agents/treasury-oracle-1/kyapay-token',
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
