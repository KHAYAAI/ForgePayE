/**
 * APY Aggregator unit tests.
 *
 * Uses vitest + mock adapters — no live RPC calls.
 *
 * Test surface:
 *   1. fetchAllApys() aggregates per-protocol APYs correctly.
 *   2. getBestVault() returns the highest-APY vault matching criteria.
 *   3. The in-memory APY cache is respected (adapter not called again within TTL).
 *   4. Asset and risk-level filters work correctly.
 *   5. Cache invalidation forces a fresh fetch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock the adapters module before importing aggregator ──────────────────────

vi.mock('../adapters', () => {
  return {
    getAdapter: vi.fn(),
  };
});

// ── Mock the config so we control the cache TTL ───────────────────────────────

vi.mock('../config', () => ({
  config: {
    apyCacheTtlMs:          15 * 60 * 1000, // 15 min (tests manipulate Date)
    ondoApiBase:            'https://api.ondo.finance/v1',
    ondoApiKey:             'test-key',
    rpc: {
      ethereum: 'http://localhost:8545',
      polygon:  'http://localhost:8546',
      base:     'http://localhost:8547',
      arbitrum: 'http://localhost:8548',
    },
    stablecoinGatewayUrl:   'http://localhost:3002',
    sweepIntervalMinutes:   15,
    corsOrigins:            [],
    signerPrivateKey:       '',
    jwtSecret:              'test',
    port:                   3007,
  },
}));

import { getAdapter } from '../adapters';
import {
  fetchAllApys,
  getBestVault,
  invalidateApyCache,
} from '../services/apyAggregator';
import { vaultsStore } from '../store';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAdapter(apy: number) {
  return {
    protocol: 'aave_v3' as const,
    getCurrentApy: vi.fn().mockResolvedValue(apy),
    getBalance:    vi.fn().mockResolvedValue(0),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('APY Aggregator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invalidateApyCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
    invalidateApyCache();
  });

  // ── fetchAllApys ──────────────────────────────────────────────────────────

  describe('fetchAllApys()', () => {
    it('returns a map with all protocols represented', async () => {
      (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(() =>
        makeAdapter(0.05),
      );

      const apys = await fetchAllApys();

      // We should have entries for the protocols configured in the vault store
      expect(apys.size).toBeGreaterThanOrEqual(2);
      expect(apys.has('aave_v3')).toBe(true);
      expect(apys.has('compound_v3')).toBe(true);
    });

    it('returns the highest APY for each protocol when multiple chains exist', async () => {
      // Aave has vaults on ethereum (4.8%), polygon (5.2%), arbitrum (5.5%)
      // Compound has vaults on ethereum (4.3%), polygon (4.5%)
      (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(
        (_protocol: string, chain: string) => {
          const apyByChain: Record<string, number> = {
            ethereum: 0.048,
            polygon:  0.052,
            arbitrum: 0.055,
            base:     0.043,
          };
          return makeAdapter(apyByChain[chain] ?? 0.04);
        },
      );

      const apys = await fetchAllApys();

      // Aave max across chains should be 5.5% (arbitrum)
      const aaveApy = apys.get('aave_v3') ?? 0;
      expect(aaveApy).toBeCloseTo(0.055, 3);
    });

    it('continues with cached/seed values when an adapter throws', async () => {
      (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        protocol: 'aave_v3',
        getCurrentApy: vi.fn().mockRejectedValue(new Error('RPC timeout')),
        getBalance:    vi.fn(),
      }));

      // Should not throw — returns seed APYs from the vault store
      const apys = await fetchAllApys();
      expect(apys).toBeDefined();
    });

    it('updates the vault store with fresh APYs', async () => {
      const freshApy = 0.0612;
      (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(() =>
        makeAdapter(freshApy),
      );

      await fetchAllApys();

      // At least one vault's APY should have been updated
      const aaveEthVault = vaultsStore.get('aave-v3-usdc-ethereum');
      expect(aaveEthVault).toBeDefined();
      expect(aaveEthVault!.apy).toBeCloseTo(freshApy, 4);
    });
  });

  // ── APY caching ───────────────────────────────────────────────────────────

  describe('APY cache', () => {
    it('does not call the adapter twice within the TTL window', async () => {
      const adapter = makeAdapter(0.05);
      (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

      // First call
      await fetchAllApys();
      const callsAfterFirst = adapter.getCurrentApy.mock.calls.length;

      // Second call within TTL — should use cache
      await fetchAllApys();
      const callsAfterSecond = adapter.getCurrentApy.mock.calls.length;

      expect(callsAfterSecond).toBe(callsAfterFirst); // no additional calls
    });

    it('re-fetches after the TTL expires', async () => {
      const adapter = makeAdapter(0.05);
      (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

      await fetchAllApys();
      const callsAfterFirst = adapter.getCurrentApy.mock.calls.length;

      // Advance time past the cache TTL (15 minutes + 1 second)
      vi.advanceTimersByTime(15 * 60 * 1000 + 1_000);

      await fetchAllApys();
      const callsAfterExpiry = adapter.getCurrentApy.mock.calls.length;

      expect(callsAfterExpiry).toBeGreaterThan(callsAfterFirst);
    });

    it('invalidateApyCache() forces a re-fetch on the next call', async () => {
      const adapter = makeAdapter(0.05);
      (getAdapter as ReturnType<typeof vi.fn>).mockReturnValue(adapter);

      await fetchAllApys();
      const countBefore = adapter.getCurrentApy.mock.calls.length;

      invalidateApyCache();
      await fetchAllApys();
      const countAfter = adapter.getCurrentApy.mock.calls.length;

      expect(countAfter).toBeGreaterThan(countBefore);
    });
  });

  // ── getBestVault ──────────────────────────────────────────────────────────

  describe('getBestVault()', () => {
    beforeEach(() => {
      // Inject predictable APYs per vault
      (getAdapter as ReturnType<typeof vi.fn>).mockImplementation(
        (protocol: string, chain: string) => {
          const key = `${protocol}-${chain}`;
          const apyMap: Record<string, number> = {
            'aave_v3-ethereum':    0.048,
            'aave_v3-polygon':     0.062, // highest for USDC
            'aave_v3-arbitrum':    0.055,
            'compound_v3-ethereum': 0.043,
            'compound_v3-polygon':  0.045,
            'ondo_usdy-ethereum':   0.051,
          };
          return makeAdapter(apyMap[key] ?? 0.04);
        },
      );
    });

    it('returns the vault with the highest APY for the given asset', async () => {
      const best = await getBestVault('USDC');
      expect(best).not.toBeNull();
      // Polygon Aave should win at 6.2%
      expect(best!.chain).toBe('polygon');
      expect(best!.protocol).toBe('aave_v3');
    });

    it('returns null when no vault exists for the requested asset', async () => {
      const best = await getBestVault('DAI');
      expect(best).toBeNull();
    });

    it('respects the minApy filter', async () => {
      // Ask for vaults with at least 10% APY — none should match
      const best = await getBestVault('USDC', 0.10);
      expect(best).toBeNull();
    });

    it('respects the riskLevel filter', async () => {
      // All seed vaults are 'low' risk; requesting 'low' should still find one
      const bestLow = await getBestVault('USDC', 0, 'low');
      expect(bestLow).not.toBeNull();
      expect(bestLow!.riskLevel).toBe('low');
    });

    it('respects the chain filter', async () => {
      const best = await getBestVault('USDC', 0, 'high', ['ethereum']);
      expect(best).not.toBeNull();
      expect(best!.chain).toBe('ethereum');
    });

    it('returns null when the chain filter excludes all vaults', async () => {
      // base has no USDC vaults in the seed store
      const best = await getBestVault('USDC', 0, 'high', ['base']);
      expect(best).toBeNull();
    });
  });
});
