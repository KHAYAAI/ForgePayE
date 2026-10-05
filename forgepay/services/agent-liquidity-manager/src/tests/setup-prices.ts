/**
 * Test fixture quotes. Production has no price table (see src/prices.ts);
 * tests that value non-pegged assets get these, refreshed before each test.
 */
import { beforeEach } from 'vitest';
import { setQuotes } from '../prices';

beforeEach(() => {
  setQuotes({ ETH: 3200, WETH: 3200, BTC: 68000, WBTC: 68000, USDY: 1, TBILL: 1, BUIDL: 1 });
});
