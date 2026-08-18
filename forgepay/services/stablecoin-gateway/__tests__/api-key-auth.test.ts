/**
 * Production fail-closed guard and per-resource ownership for
 * stablecoin-gateway's API-key auth plugin.
 *
 * Before this fix, `VALID_API_KEYS` unset in production meant
 * `validKeys.size > 0` was false, which collapsed the auth check to "any
 * non-empty key is accepted" — fail OPEN for a service that mints crypto
 * deposit addresses. There was also no notion of which merchant a key
 * belonged to, so any valid key could read any other merchant's deposit
 * record by ID. Both are fixed in src/plugins/api-key-auth.ts; this file
 * covers resolveAdminKeyHashes(), resolveMerchantKeyMap() and
 * merchantAccessError() directly, and the full onRequest hook end-to-end
 * via a minimal app.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import apiKeyAuth, {
  resolveAdminKeyHashes,
  resolveMerchantKeyMap,
  merchantAccessError,
  type AuthContext,
} from '../src/plugins/api-key-auth';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env['VALID_API_KEYS'];
  delete process.env['MERCHANT_API_KEYS'];
}

describe('resolveAdminKeyHashes', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('is empty outside production, even with no keys configured', () => {
    process.env['NODE_ENV'] = 'development';
    expect(resolveAdminKeyHashes().size).toBe(0);
  });

  it('throws in production when VALID_API_KEYS is unset', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveAdminKeyHashes()).toThrow(/refuses to start/);
  });

  it('throws in production when VALID_API_KEYS is only the dev placeholder', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'dev-stablecoin-key';
    expect(() => resolveAdminKeyHashes()).toThrow(/development placeholder/);
  });

  it('throws in production when a key is shorter than 32 characters', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'short-key';
    expect(() => resolveAdminKeyHashes()).toThrow(/at least 32 characters/);
  });

  it('does not throw in production once a real key is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'a'.repeat(32);
    expect(() => resolveAdminKeyHashes()).not.toThrow();
    expect(resolveAdminKeyHashes().size).toBe(1);
  });
});

describe('resolveMerchantKeyMap', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('is empty when MERCHANT_API_KEYS is unset', () => {
    expect(resolveMerchantKeyMap().size).toBe(0);
  });

  it('parses a single merchantId:key pair', () => {
    process.env['MERCHANT_API_KEYS'] = 'merch_a:key_a_value';
    expect(resolveMerchantKeyMap().size).toBe(1);
  });

  it('parses multiple comma-separated pairs', () => {
    process.env['MERCHANT_API_KEYS'] = 'merch_a:key_a,merch_b:key_b';
    expect(resolveMerchantKeyMap().size).toBe(2);
  });

  it('ignores malformed entries with no colon', () => {
    process.env['MERCHANT_API_KEYS'] = 'not-a-pair,merch_a:key_a';
    expect(resolveMerchantKeyMap().size).toBe(1);
  });
});

describe('merchantAccessError', () => {
  it('denies when auth context is missing', () => {
    expect(merchantAccessError(undefined, 'merch_a')).not.toBeNull();
  });

  it('allows an admin to access any merchant\'s resource', () => {
    const admin: AuthContext = { principalId: 'admin', kind: 'admin' };
    expect(merchantAccessError(admin, 'merch_a')).toBeNull();
    expect(merchantAccessError(admin, 'merch_b')).toBeNull();
  });

  it('allows a merchant to access its own resource', () => {
    const auth: AuthContext = { principalId: 'merch_a', kind: 'merchant' };
    expect(merchantAccessError(auth, 'merch_a')).toBeNull();
  });

  it('denies a merchant accessing another merchant\'s resource — 403 not silent', () => {
    const auth: AuthContext = { principalId: 'merch_a', kind: 'merchant' };
    const err = merchantAccessError(auth, 'merch_b');
    expect(err).not.toBeNull();
    expect(err?.error).toBe('Forbidden');
  });
});

describe('api-key-auth plugin — end to end', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  async function buildTestApp() {
    const app = Fastify({ logger: false });
    await app.register(apiKeyAuth);
    app.get('/protected', async (req) => ({
      principalId: req.auth?.principalId,
      kind:        req.auth?.kind,
    }));
    return app;
  }

  it('rejects a request with no API key', async () => {
    process.env['NODE_ENV'] = 'development';
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/protected' });
    expect(res.statusCode).toBe(401);
  });

  it('dev fallback: any non-empty key authenticates as admin when nothing is configured', async () => {
    process.env['NODE_ENV'] = 'development';
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { 'x-api-key': 'anything' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().kind).toBe('admin');
  });

  it('once MERCHANT_API_KEYS is set, an unrecognised key is rejected outright', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['MERCHANT_API_KEYS'] = 'merch_a:key_a_value';
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { 'x-api-key': 'not-registered' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('a registered merchant key resolves to that merchant\'s identity', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['MERCHANT_API_KEYS'] = 'merch_a:key_a_value';
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { 'x-api-key': 'key_a_value' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ principalId: 'merch_a', kind: 'merchant' });
  });

  it('an admin key resolves to the admin principal', async () => {
    process.env['NODE_ENV'] = 'development';
    process.env['VALID_API_KEYS'] = 'a'.repeat(32);
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'GET', url: '/protected', headers: { 'x-api-key': 'a'.repeat(32) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ principalId: 'admin', kind: 'admin' });
  });
});
