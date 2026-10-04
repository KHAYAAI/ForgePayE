import { describe, it, expect } from 'vitest';
import { launchedProducts, productOpenTo } from './launch-gate';

const env = (o: Record<string, string>) => o as NodeJS.ProcessEnv;

describe('launch gate', () => {
  it('in production only the credit bureau is open unless products are launched by name', () => {
    const prod = env({ NODE_ENV: 'production' });
    expect(productOpenTo('credit-bureau', 't1', prod)).toBe(true);
    for (const p of ['payments', 'treasury', 'wallet', 'custody']) expect(productOpenTo(p, 't1', prod)).toBe(false);
  });
  it('custody opens only to named design partners before it launches', () => {
    const e = env({ NODE_ENV: 'production', FORGE_DESIGN_PARTNERS_CUSTODY: 'partner-a, partner-b' });
    expect(productOpenTo('custody', 'partner-b', e)).toBe(true);
    expect(productOpenTo('custody', 'someone-else', e)).toBe(false);
    expect(productOpenTo('payments', 'partner-b', e)).toBe(false); // design-partner status is per product
  });
  it('an explicit list replaces the default; development keeps everything open', () => {
    expect(productOpenTo('custody', 't', env({ NODE_ENV: 'production', FORGE_LAUNCHED_PRODUCTS: 'credit-bureau,custody' }))).toBe(true);
    expect(launchedProducts(env({ NODE_ENV: 'development' }))).toBe('all');
  });
});
