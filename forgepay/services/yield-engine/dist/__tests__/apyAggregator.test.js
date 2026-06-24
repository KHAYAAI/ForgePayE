"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// ── Mock the adapters module before importing aggregator ──────────────────────
vitest_1.vi.mock('../../adapters', () => {
    return {
        getAdapter: vitest_1.vi.fn(),
    };
});
// ── Mock the config so we control the cache TTL ───────────────────────────────
vitest_1.vi.mock('../../config', () => ({
    config: {
        apyCacheTtlMs: 15 * 60 * 1000, // 15 min (tests manipulate Date)
        ondoApiBase: 'https://api.ondo.finance/v1',
        ondoApiKey: 'test-key',
        rpc: {
            ethereum: 'http://localhost:8545',
            polygon: 'http://localhost:8546',
            base: 'http://localhost:8547',
            arbitrum: 'http://localhost:8548',
        },
        stablecoinGatewayUrl: 'http://localhost:3002',
        sweepIntervalMinutes: 15,
        corsOrigins: [],
        signerPrivateKey: '',
        jwtSecret: 'test',
        port: 3007,
    },
}));
const adapters_1 = require("../../adapters");
const apyAggregator_1 = require("../../services/apyAggregator");
const store_1 = require("../../store");
// ── Helpers ───────────────────────────────────────────────────────────────────
function makeAdapter(apy) {
    return {
        protocol: 'aave_v3',
        getCurrentApy: vitest_1.vi.fn().mockResolvedValue(apy),
        getBalance: vitest_1.vi.fn().mockResolvedValue(0),
    };
}
// ── Tests ─────────────────────────────────────────────────────────────────────
(0, vitest_1.describe)('APY Aggregator', () => {
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
        (0, apyAggregator_1.invalidateApyCache)();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
        vitest_1.vi.resetAllMocks();
        (0, apyAggregator_1.invalidateApyCache)();
    });
    // ── fetchAllApys ──────────────────────────────────────────────────────────
    (0, vitest_1.describe)('fetchAllApys()', () => {
        (0, vitest_1.it)('returns a map with all protocols represented', async () => {
            adapters_1.getAdapter.mockImplementation(() => makeAdapter(0.05));
            const apys = await (0, apyAggregator_1.fetchAllApys)();
            // We should have entries for the protocols configured in the vault store
            (0, vitest_1.expect)(apys.size).toBeGreaterThanOrEqual(2);
            (0, vitest_1.expect)(apys.has('aave_v3')).toBe(true);
            (0, vitest_1.expect)(apys.has('compound_v3')).toBe(true);
        });
        (0, vitest_1.it)('returns the highest APY for each protocol when multiple chains exist', async () => {
            // Aave has vaults on ethereum (4.8%), polygon (5.2%), arbitrum (5.5%)
            // Compound has vaults on ethereum (4.3%), polygon (4.5%)
            adapters_1.getAdapter.mockImplementation((_protocol, chain) => {
                const apyByChain = {
                    ethereum: 0.048,
                    polygon: 0.052,
                    arbitrum: 0.055,
                    base: 0.043,
                };
                return makeAdapter(apyByChain[chain] ?? 0.04);
            });
            const apys = await (0, apyAggregator_1.fetchAllApys)();
            // Aave max across chains should be 5.5% (arbitrum)
            const aaveApy = apys.get('aave_v3') ?? 0;
            (0, vitest_1.expect)(aaveApy).toBeCloseTo(0.055, 3);
        });
        (0, vitest_1.it)('continues with cached/seed values when an adapter throws', async () => {
            adapters_1.getAdapter.mockImplementation(() => ({
                protocol: 'aave_v3',
                getCurrentApy: vitest_1.vi.fn().mockRejectedValue(new Error('RPC timeout')),
                getBalance: vitest_1.vi.fn(),
            }));
            // Should not throw — returns seed APYs from the vault store
            const apys = await (0, apyAggregator_1.fetchAllApys)();
            (0, vitest_1.expect)(apys).toBeDefined();
        });
        (0, vitest_1.it)('updates the vault store with fresh APYs', async () => {
            const freshApy = 0.0612;
            adapters_1.getAdapter.mockImplementation(() => makeAdapter(freshApy));
            await (0, apyAggregator_1.fetchAllApys)();
            // At least one vault's APY should have been updated
            const aaveEthVault = store_1.vaultsStore.get('aave-v3-usdc-ethereum');
            (0, vitest_1.expect)(aaveEthVault).toBeDefined();
            (0, vitest_1.expect)(aaveEthVault.apy).toBeCloseTo(freshApy, 4);
        });
    });
    // ── APY caching ───────────────────────────────────────────────────────────
    (0, vitest_1.describe)('APY cache', () => {
        (0, vitest_1.it)('does not call the adapter twice within the TTL window', async () => {
            const adapter = makeAdapter(0.05);
            adapters_1.getAdapter.mockReturnValue(adapter);
            // First call
            await (0, apyAggregator_1.fetchAllApys)();
            const callsAfterFirst = adapter.getCurrentApy.mock.calls.length;
            // Second call within TTL — should use cache
            await (0, apyAggregator_1.fetchAllApys)();
            const callsAfterSecond = adapter.getCurrentApy.mock.calls.length;
            (0, vitest_1.expect)(callsAfterSecond).toBe(callsAfterFirst); // no additional calls
        });
        (0, vitest_1.it)('re-fetches after the TTL expires', async () => {
            const adapter = makeAdapter(0.05);
            adapters_1.getAdapter.mockReturnValue(adapter);
            await (0, apyAggregator_1.fetchAllApys)();
            const callsAfterFirst = adapter.getCurrentApy.mock.calls.length;
            // Advance time past the cache TTL (15 minutes + 1 second)
            vitest_1.vi.advanceTimersByTime(15 * 60 * 1000 + 1_000);
            await (0, apyAggregator_1.fetchAllApys)();
            const callsAfterExpiry = adapter.getCurrentApy.mock.calls.length;
            (0, vitest_1.expect)(callsAfterExpiry).toBeGreaterThan(callsAfterFirst);
        });
        (0, vitest_1.it)('invalidateApyCache() forces a re-fetch on the next call', async () => {
            const adapter = makeAdapter(0.05);
            adapters_1.getAdapter.mockReturnValue(adapter);
            await (0, apyAggregator_1.fetchAllApys)();
            const countBefore = adapter.getCurrentApy.mock.calls.length;
            (0, apyAggregator_1.invalidateApyCache)();
            await (0, apyAggregator_1.fetchAllApys)();
            const countAfter = adapter.getCurrentApy.mock.calls.length;
            (0, vitest_1.expect)(countAfter).toBeGreaterThan(countBefore);
        });
    });
    // ── getBestVault ──────────────────────────────────────────────────────────
    (0, vitest_1.describe)('getBestVault()', () => {
        (0, vitest_1.beforeEach)(() => {
            // Inject predictable APYs per vault
            adapters_1.getAdapter.mockImplementation((protocol, chain) => {
                const key = `${protocol}-${chain}`;
                const apyMap = {
                    'aave_v3-ethereum': 0.048,
                    'aave_v3-polygon': 0.062, // highest for USDC
                    'aave_v3-arbitrum': 0.055,
                    'compound_v3-ethereum': 0.043,
                    'compound_v3-polygon': 0.045,
                    'ondo_usdy-ethereum': 0.051,
                };
                return makeAdapter(apyMap[key] ?? 0.04);
            });
        });
        (0, vitest_1.it)('returns the vault with the highest APY for the given asset', async () => {
            const best = await (0, apyAggregator_1.getBestVault)('USDC');
            (0, vitest_1.expect)(best).not.toBeNull();
            // Polygon Aave should win at 6.2%
            (0, vitest_1.expect)(best.chain).toBe('polygon');
            (0, vitest_1.expect)(best.protocol).toBe('aave_v3');
        });
        (0, vitest_1.it)('returns null when no vault exists for the requested asset', async () => {
            const best = await (0, apyAggregator_1.getBestVault)('DAI');
            (0, vitest_1.expect)(best).toBeNull();
        });
        (0, vitest_1.it)('respects the minApy filter', async () => {
            // Ask for vaults with at least 10% APY — none should match
            const best = await (0, apyAggregator_1.getBestVault)('USDC', 0.10);
            (0, vitest_1.expect)(best).toBeNull();
        });
        (0, vitest_1.it)('respects the riskLevel filter', async () => {
            // All seed vaults are 'low' risk; requesting 'low' should still find one
            const bestLow = await (0, apyAggregator_1.getBestVault)('USDC', 0, 'low');
            (0, vitest_1.expect)(bestLow).not.toBeNull();
            (0, vitest_1.expect)(bestLow.riskLevel).toBe('low');
        });
        (0, vitest_1.it)('respects the chain filter', async () => {
            const best = await (0, apyAggregator_1.getBestVault)('USDC', 0, 'high', ['ethereum']);
            (0, vitest_1.expect)(best).not.toBeNull();
            (0, vitest_1.expect)(best.chain).toBe('ethereum');
        });
        (0, vitest_1.it)('returns null when the chain filter excludes all vaults', async () => {
            // base has no USDC vaults in the seed store
            const best = await (0, apyAggregator_1.getBestVault)('USDC', 0, 'high', ['base']);
            (0, vitest_1.expect)(best).toBeNull();
        });
    });
});
//# sourceMappingURL=apyAggregator.test.js.map