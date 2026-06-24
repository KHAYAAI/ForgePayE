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
export {};
//# sourceMappingURL=apyAggregator.test.d.ts.map