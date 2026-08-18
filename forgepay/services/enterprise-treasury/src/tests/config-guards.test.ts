/**
 * Production fail-closed guards for enterprise-treasury.
 *
 * Before this fix, `VALID_API_KEYS` unset in production meant
 * `validKeys.size > 0` was false, which collapsed the auth check to "any
 * non-empty key is accepted" — fail OPEN for cash positions, FX rates and
 * treasury rules. `CORS_ORIGIN` unset meant `origin: '*'` reached production
 * with no guard. Both now throw at boot instead of degrading silently,
 * mirroring agent-credit-bureau's `resolveCorsOrigin()` /
 * agent-negotiation's `resolveAdminKeyHashes()`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { resolveApiKeys, resolveCorsOrigin, buildApp } from '../index';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env['VALID_API_KEYS'];
  delete process.env['CORS_ORIGIN'];
}

describe('resolveApiKeys', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('is a no-op outside production, even with no keys configured', () => {
    process.env['NODE_ENV'] = 'development';
    expect(resolveApiKeys().size).toBe(0);
  });

  it('throws in production when VALID_API_KEYS is unset', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveApiKeys()).toThrow(/refuses to start/);
  });

  it('throws in production when VALID_API_KEYS is only a dev placeholder', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'dev-treasury-key';
    expect(() => resolveApiKeys()).toThrow(/development placeholder/);
  });

  it('throws in production when a key is shorter than 32 characters', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'short-key';
    expect(() => resolveApiKeys()).toThrow(/at least 32 characters/);
  });

  it('does not throw in production once a real key is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'a'.repeat(32);
    expect(() => resolveApiKeys()).not.toThrow();
    expect(resolveApiKeys().has('a'.repeat(32))).toBe(true);
  });

  it('accepts a comma-separated list of real keys', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = `${'a'.repeat(32)},${'b'.repeat(32)}`;
    const keys = resolveApiKeys();
    expect(keys.size).toBe(2);
  });
});

describe('resolveCorsOrigin', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('defaults to * outside production', () => {
    process.env['NODE_ENV'] = 'development';
    expect(resolveCorsOrigin()).toBe('*');
  });

  it('throws in production when CORS_ORIGIN is unset', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => resolveCorsOrigin()).toThrow(/refuses to start/);
  });

  it('throws in production when CORS_ORIGIN is still *', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ORIGIN'] = '*';
    expect(() => resolveCorsOrigin()).toThrow(/refuses to start/);
  });

  it('accepts a single explicit origin in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ORIGIN'] = 'https://treasury.forgepay.io';
    expect(resolveCorsOrigin()).toBe('https://treasury.forgepay.io');
  });

  it('splits a comma-separated allowlist into an array', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ORIGIN'] = 'https://treasury.forgepay.io, https://app.forgepay.io';
    expect(resolveCorsOrigin()).toEqual([
      'https://treasury.forgepay.io',
      'https://app.forgepay.io',
    ]);
  });
});

describe('buildApp production boot refusal', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('refuses to build in production with no VALID_API_KEYS', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ORIGIN'] = 'https://treasury.forgepay.io';
    await expect(buildApp()).rejects.toThrow(/refuses to start/);
  });

  it('refuses to build in production with no CORS_ORIGIN', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'a'.repeat(32);
    await expect(buildApp()).rejects.toThrow(/refuses to start/);
  });

  it('builds and enforces the allowlist once both are configured', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'a'.repeat(32);
    process.env['CORS_ORIGIN'] = 'https://treasury.forgepay.io';

    let app: FastifyInstance | undefined;
    try {
      app = await buildApp();
      await app.ready();

      const noKey = await app.inject({ method: 'GET', url: '/v1/fx-rates' });
      expect(noKey.statusCode).toBe(401);

      const badKey = await app.inject({
        method: 'GET', url: '/v1/fx-rates',
        headers: { 'x-api-key': 'not-a-real-key-and-not-empty' },
      });
      expect(badKey.statusCode).toBe(401);

      const goodKey = await app.inject({
        method: 'GET', url: '/v1/fx-rates',
        headers: { 'x-api-key': 'a'.repeat(32) },
      });
      expect(goodKey.statusCode).toBe(200);
    } finally {
      await app?.close();
    }
  });
});
