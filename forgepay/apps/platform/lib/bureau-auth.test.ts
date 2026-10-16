import { afterEach, describe, expect, it, vi } from 'vitest';
import { bureauAuthHeaders, treasuryAuthHeaders } from './forge-services';

const saved = { key: process.env.BUREAU_ADMIN_API_KEY, tkey: process.env.TREASURY_API_KEY, env: process.env.NODE_ENV };
afterEach(() => {
  if (saved.key === undefined) delete process.env.BUREAU_ADMIN_API_KEY; else process.env.BUREAU_ADMIN_API_KEY = saved.key;
  if (saved.tkey === undefined) delete process.env.TREASURY_API_KEY; else process.env.TREASURY_API_KEY = saved.tkey;
  (process.env as Record<string, string | undefined>).NODE_ENV = saved.env;
  vi.restoreAllMocks();
});
const setEnv = (v: string) => { (process.env as Record<string, string | undefined>).NODE_ENV = v; };

describe('the credential the console presents to the bureau', () => {
  it('is the configured key, in any environment', () => {
    process.env.BUREAU_ADMIN_API_KEY = 'configured-key-of-reasonable-length-0123456789';
    for (const env of ['production', 'development', 'test']) {
      setEnv(env);
      expect(bureauAuthHeaders()).toEqual({ authorization: 'Bearer configured-key-of-reasonable-length-0123456789' });
    }
  });

  it('is NOTHING in production when no key is set, never the development key published in this repository', () => {
    delete process.env.BUREAU_ADMIN_API_KEY; setEnv('production');
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(bureauAuthHeaders()).toEqual({});
    expect(JSON.stringify(bureauAuthHeaders())).not.toContain('dev-bureau-admin-key');
    expect(err).toHaveBeenCalledTimes(1);                                   // said once, not on every request
    expect(String(err.mock.calls[0]![0])).toContain('BUREAU_ADMIN_API_KEY');
  });

  it('keeps the development convenience outside production', () => {
    delete process.env.BUREAU_ADMIN_API_KEY;
    for (const env of ['development', 'test']) {
      setEnv(env);
      expect(bureauAuthHeaders()).toEqual({ authorization: 'Bearer dev-bureau-admin-key' });
    }
  });
});

describe('the credential the console presents to enterprise-treasury', () => {
  it('is the configured key; in production with none set it is nothing, never the development key; in development the convenience stays', () => {
    process.env.TREASURY_API_KEY = 'configured-treasury-key-0123456789';
    setEnv('production');
    expect(treasuryAuthHeaders()).toEqual({ 'x-api-key': 'configured-treasury-key-0123456789' });

    delete process.env.TREASURY_API_KEY;
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(treasuryAuthHeaders()).toEqual({});
    expect(treasuryAuthHeaders()).toEqual({});
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toContain('TREASURY_API_KEY');

    setEnv('development');
    expect(treasuryAuthHeaders()).toEqual({ 'x-api-key': 'dev-console-treasury-key' });
  });
});
