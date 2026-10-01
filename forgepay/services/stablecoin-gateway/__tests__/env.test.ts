import { describe, it, expect } from 'vitest';
import { isProductionLike } from '../src/lib/env.js';
import { resolveAdminKeyHashes } from '../src/plugins/api-key-auth.js';

describe('production mode fails closed', () => {
  it('only an explicit development or test is non-production (was: unset meant development)', () => {
    expect(isProductionLike({})).toBe(true);
    expect(isProductionLike({ NODE_ENV: '' })).toBe(true);
    expect(isProductionLike({ NODE_ENV: 'prod' })).toBe(true);
    expect(isProductionLike({ NODE_ENV: 'staging' })).toBe(true);
    expect(isProductionLike({ NODE_ENV: 'production' })).toBe(true);
    expect(isProductionLike({ NODE_ENV: 'development' })).toBe(false);
    expect(isProductionLike({ NODE_ENV: 'TEST' })).toBe(false);
  });

  it('with NODE_ENV unset the gateway refuses to start without real admin keys, instead of making every key admin', () => {
    const saved = { n: process.env['NODE_ENV'], k: process.env['VALID_API_KEYS'] };
    delete process.env['NODE_ENV']; delete process.env['VALID_API_KEYS'];
    try { expect(() => resolveAdminKeyHashes()).toThrow(/VALID_API_KEYS/); }
    finally {
      if (saved.n !== undefined) process.env['NODE_ENV'] = saved.n;
      if (saved.k !== undefined) process.env['VALID_API_KEYS'] = saved.k;
    }
  });
});
