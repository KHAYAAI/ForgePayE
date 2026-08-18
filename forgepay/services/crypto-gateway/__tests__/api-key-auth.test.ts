import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import {
  resolveAdminKeyHashes,
  resolveMerchantKeyMap,
  registerApiKeyAuth,
  invoiceAccessError,
} from '../src/plugins/api-key-auth.js';

const ENV_KEYS = ['NODE_ENV', 'VALID_API_KEYS', 'MERCHANT_API_KEYS'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

// ── Production auth: fail closed, not open ───────────────────────────────────
//
// Regression coverage for the bug where `VALID_API_KEYS` unset in production
// silently accepted any non-empty key (`validKeys.size > 0` was false, so the
// whole guard collapsed: `!isDev && validKeys.size > 0 && !validKeys.has(apiKey)`
// is false whenever validKeys is empty). The service must now refuse to boot.

describe('resolveAdminKeyHashes — production fails closed', () => {
  it('throws when VALID_API_KEYS is not set in production', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['VALID_API_KEYS'];

    expect(() => resolveAdminKeyHashes()).toThrow(/VALID_API_KEYS is not set/);
  });

  it('throws when VALID_API_KEYS is the development placeholder', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'dev-crypto-gateway-key';

    expect(() => resolveAdminKeyHashes()).toThrow(/development placeholder/);
  });

  it('throws when a configured key is shorter than 32 characters', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'short-key';

    expect(() => resolveAdminKeyHashes()).toThrow(/at least 32 characters/);
  });

  it('succeeds with a sufficiently long VALID_API_KEYS in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'a'.repeat(40);

    expect(() => resolveAdminKeyHashes()).not.toThrow();
    expect(resolveAdminKeyHashes().size).toBe(1);
  });

  it('does not throw outside production even when unset', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['VALID_API_KEYS'];

    expect(() => resolveAdminKeyHashes()).not.toThrow();
    expect(resolveAdminKeyHashes().size).toBe(0);
  });
});

describe('registerApiKeyAuth — boot and request behaviour', () => {
  it('refuses to boot (throws synchronously) in production without VALID_API_KEYS', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['VALID_API_KEYS'];
    delete process.env['MERCHANT_API_KEYS'];

    const app = Fastify();
    expect(() => registerApiKeyAuth(app)).toThrow(/VALID_API_KEYS is not set/);
  });

  it('boots in production with a valid VALID_API_KEYS and enforces it', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'b'.repeat(40);
    delete process.env['MERCHANT_API_KEYS'];

    const app = Fastify();
    registerApiKeyAuth(app);
    app.get('/probe', async () => ({ ok: true }));
    await app.ready();

    const unauthed = await app.inject({ method: 'GET', url: '/probe' });
    expect(unauthed.statusCode).toBe(401);

    const wrongKey = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-api-key': 'c'.repeat(40) } });
    expect(wrongKey.statusCode).toBe(401);

    const rightKey = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-api-key': 'b'.repeat(40) } });
    expect(rightKey.statusCode).toBe(200);

    await app.close();
  });

  it('dev fallback: any non-empty key authenticates as admin when nothing is configured', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['VALID_API_KEYS'];
    delete process.env['MERCHANT_API_KEYS'];

    const app = Fastify();
    registerApiKeyAuth(app);
    app.get('/probe', async (req) => ({ auth: req.auth }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-api-key': 'literally-anything' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ auth: { principalId: 'admin', kind: 'admin' } });

    await app.close();
  });

  it('once MERCHANT_API_KEYS is set, the permissive dev fallback turns off', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['VALID_API_KEYS'];
    process.env['MERCHANT_API_KEYS'] = 'merchant-a:merchant-a-key-0000000000000';

    const app = Fastify();
    registerApiKeyAuth(app);
    app.get('/probe', async (req) => ({ auth: req.auth }));
    await app.ready();

    const unknown = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-api-key': 'not-configured' } });
    expect(unknown.statusCode).toBe(401);

    const known = await app.inject({ method: 'GET', url: '/probe', headers: { 'x-api-key': 'merchant-a-key-0000000000000' } });
    expect(known.statusCode).toBe(200);
    expect(known.json()).toEqual({ auth: { principalId: 'merchant-a', kind: 'merchant' } });

    await app.close();
  });

  it('health endpoint is exempt from auth', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'd'.repeat(40);

    const app = Fastify();
    registerApiKeyAuth(app);
    app.get('/health', async () => ({ status: 'ok' }));
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);

    await app.close();
  });
});

describe('resolveMerchantKeyMap', () => {
  it('parses a merchantId:key,merchantId:key list', () => {
    process.env['MERCHANT_API_KEYS'] = 'merchant-a:key-a-000000000,merchant-b:key-b-000000000';
    const map = resolveMerchantKeyMap();
    expect(map.size).toBe(2);
  });

  it('returns an empty map when unset', () => {
    delete process.env['MERCHANT_API_KEYS'];
    expect(resolveMerchantKeyMap().size).toBe(0);
  });
});

describe('invoiceAccessError', () => {
  it('rejects when auth context is missing', () => {
    expect(invoiceAccessError(undefined, 'merchant-a')).toEqual({
      error: 'Unauthorized',
      message: 'Missing authentication context.',
    });
  });

  it('allows admin to act on any merchant\'s invoice', () => {
    expect(invoiceAccessError({ principalId: 'admin', kind: 'admin' }, 'merchant-a')).toBeNull();
  });

  it('allows a merchant to act on its own invoice', () => {
    expect(invoiceAccessError({ principalId: 'merchant-a', kind: 'merchant' }, 'merchant-a')).toBeNull();
  });

  it('rejects a merchant acting on another merchant\'s invoice', () => {
    const err = invoiceAccessError({ principalId: 'merchant-a', kind: 'merchant' }, 'merchant-b');
    expect(err).not.toBeNull();
    expect(err?.error).toBe('Forbidden');
  });
});
