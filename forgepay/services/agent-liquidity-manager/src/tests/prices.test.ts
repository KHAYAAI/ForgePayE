/**
 * Holdings are valued on live quotes, never on a built-in table.
 * The old table priced ETH at $3,200 and BTC at $68,000 indefinitely and
 * treated USDY (which accrues above $1) as $1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { rateFor, setQuotes, clearQuotes, PriceUnavailableError, refreshPrices } from '../prices';
import { toUsd } from '../rebalancer';

describe('prices', () => {
  beforeEach(() => clearQuotes());

  it('values pegged stablecoins at $1 without a feed', () => {
    expect(rateFor('usdc')).toBe(1);
    expect(toUsd(250, 'DAI')).toBe(250);
  });

  it('refuses to value anything else without a quote (no hardcoded fallback)', () => {
    expect(() => rateFor('ETH')).toThrow(PriceUnavailableError);
    expect(() => toUsd(1, 'USDY')).toThrow(/USDY/);
  });

  it('refuses a stale quote', () => {
    setQuotes({ ETH: 2500 }, Date.now() - 3600_000);
    expect(() => rateFor('ETH')).toThrow(/old/);
  });

  it('reads quotes from the configured feed', async () => {
    process.env['PRICE_FEED_URL'] = 'http://feed.test/prices';
    const n = await refreshPrices((async () => new Response(JSON.stringify({ prices: { ETH: 2512.5, USDY: 1.09 } }), { status: 200 })) as typeof fetch);
    delete process.env['PRICE_FEED_URL'];
    expect(n).toBe(2);
    expect(rateFor('ETH')).toBe(2512.5);
    expect(toUsd(100, 'USDY')).toBeCloseTo(109);
  });
});
