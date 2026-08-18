import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// config.ts evaluates its `export const config = {...}` (including the CORS
// resolution) at module-import time, so exercising different env
// combinations requires resetting the module registry and re-importing for
// each case.

const ENV_KEYS = ['NODE_ENV', 'CORS_ALLOWED_ORIGINS'] as const;
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

async function loadConfig() {
  vi.resetModules();
  const { config } = await import('../src/config.js');
  return config;
}

describe('CORS allowlist — production fails closed', () => {
  // Regression coverage for the bug where CORS_ALLOWED_ORIGINS unset in
  // production silently fell back to a dev-only origin (no guard at all),
  // and a "*" value would open every response to every website's browser JS.

  it('throws in production when CORS_ALLOWED_ORIGINS is not set', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['CORS_ALLOWED_ORIGINS'];

    await expect(loadConfig()).rejects.toThrow(/CORS_ALLOWED_ORIGINS is not set/);
  });

  it('throws in production when CORS_ALLOWED_ORIGINS is "*"', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ALLOWED_ORIGINS'] = '*';

    await expect(loadConfig()).rejects.toThrow(/CORS_ALLOWED_ORIGINS is not set/);
  });

  it('throws in production when "*" is included among other origins', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://dashboard.forgepay.io,*';

    await expect(loadConfig()).rejects.toThrow(/CORS_ALLOWED_ORIGINS is not set/);
  });

  it('succeeds in production with an explicit allowlist', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CORS_ALLOWED_ORIGINS'] = 'https://dashboard.forgepay.io';

    const config = await loadConfig();
    expect(config.corsAllowedOrigins).toEqual(['https://dashboard.forgepay.io']);
  });

  it('falls back to the localhost dev origin outside production when unset', async () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['CORS_ALLOWED_ORIGINS'];

    const config = await loadConfig();
    expect(config.corsAllowedOrigins).toEqual(['http://localhost:3001']);
  });
});
