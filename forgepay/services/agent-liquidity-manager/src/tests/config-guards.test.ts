/**
 * Production fail-closed guard for CORS. Mirrors the convention established
 * in agent-credit-bureau/src/config-guards.test.ts — missing/unsafe
 * production config throws at startup rather than degrading silently.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveCorsOrigin } from '../index';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  delete process.env['CORS_ORIGIN'];
}

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
