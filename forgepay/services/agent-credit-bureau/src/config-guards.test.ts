/**
 * The production fail-closed guards added alongside the platform-wide
 * hardening pass: persistence (db.ts), CORS (index.ts) and the Redis
 * rate-limit opt-in (redis.ts). Mirrors the existing convention for
 * BUREAU_ADMIN_API_KEY (auth.ts) and CONSENT_SIGNING_SECRET (consent.ts) —
 * missing/unsafe production config throws at startup rather than degrading
 * silently.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isDbEnabled, assertPersistenceConfigured } from './db';
import { resolveCorsOrigin } from './index';
import { isRedisEnabled } from './redis';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env['DATABASE_URL'];
  delete process.env['DB_HOST'];
  delete process.env['CORS_ORIGIN'];
  delete process.env['REDIS_URL'];
}

describe('assertPersistenceConfigured', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('is a no-op outside production, even with no database configured', () => {
    process.env['NODE_ENV'] = 'development';
    expect(isDbEnabled()).toBe(false);
    expect(() => assertPersistenceConfigured()).not.toThrow();
  });

  it('throws in production with neither DATABASE_URL nor DB_HOST set', () => {
    process.env['NODE_ENV'] = 'production';
    expect(() => assertPersistenceConfigured()).toThrow(/refuses to start/);
  });

  it('does not throw in production once DATABASE_URL is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['DATABASE_URL'] = 'postgres://user:pass@host:5432/db';
    expect(() => assertPersistenceConfigured()).not.toThrow();
  });

  it('does not throw in production once DB_HOST is set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['DB_HOST'] = 'postgres.internal';
    expect(() => assertPersistenceConfigured()).not.toThrow();
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
    process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io';
    expect(resolveCorsOrigin()).toBe('https://dashboard.forgepay.io');
  });

  it('splits a comma-separated allowlist into an array', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ORIGIN'] = 'https://dashboard.forgepay.io, https://app.forgepay.io';
    expect(resolveCorsOrigin()).toEqual(['https://dashboard.forgepay.io', 'https://app.forgepay.io']);
  });
});

describe('isRedisEnabled', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('is false with REDIS_URL unset — falls back to in-memory rate limiting', () => {
    expect(isRedisEnabled()).toBe(false);
  });

  it('is true once REDIS_URL is set', () => {
    process.env['REDIS_URL'] = 'redis://localhost:6379';
    expect(isRedisEnabled()).toBe(true);
  });
});
