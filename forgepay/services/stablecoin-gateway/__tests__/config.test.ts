/**
 * resolveCorsOrigins() production fail-closed guard.
 *
 * config.ts builds its exported `config` object eagerly at module-load
 * time, so each case here resets the module cache and re-imports fresh
 * rather than calling a function repeatedly against one cached module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

function resetEnv() {
  process.env = { ...ORIGINAL_ENV };
  // config.ts requires these regardless of what's under test here.
  process.env['POSTGRES_PASSWORD']      = 'test-password';
  process.env['INTERNAL_WEBHOOK_SECRET'] = 'test-webhook-secret';
  delete process.env['CORS_ALLOWED_ORIGINS'];
}

async function loadResolveCorsOrigins() {
  vi.resetModules();
  const mod = await import('../src/config');
  return mod.resolveCorsOrigins;
}

describe('resolveCorsOrigins', () => {
  beforeEach(resetEnv);
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

  it('defaults to localhost outside production', async () => {
    process.env['NODE_ENV'] = 'development';
    const resolveCorsOrigins = await loadResolveCorsOrigins();
    expect(resolveCorsOrigins()).toEqual(['http://localhost:3001']);
  });

  it('throws on module load in production when CORS_ALLOWED_ORIGINS is unset', async () => {
    process.env['NODE_ENV'] = 'production';
    vi.resetModules();
    await expect(import('../src/config')).rejects.toThrow(/refuses to/);
  });

  it('throws in production when CORS_ALLOWED_ORIGINS is "*"', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ALLOWED_ORIGINS'] = '*';
    vi.resetModules();
    await expect(import('../src/config')).rejects.toThrow(/refuses to/);
  });

  it('accepts an explicit allowlist in production', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://dashboard.forgepay.io,https://app.forgepay.io';
    const resolveCorsOrigins = await loadResolveCorsOrigins();
    expect(resolveCorsOrigins()).toEqual([
      'https://dashboard.forgepay.io',
      'https://app.forgepay.io',
    ]);
  });
});
