/**
 * APY Aggregator.
 *
 * Responsible for:
 *   1. Fetching current APYs from every configured vault in parallel.
 *   2. Caching results for `APY_CACHE_TTL_MS` (default: 15 min).
 *   3. Selecting the best vault for a given asset / risk criteria.
 *
 * PROD NOTE: The in-memory cache should be replaced with Redis (SETEX) so
 * multiple pod replicas share a single source of truth and a crash doesn't
 * force an immediate re-fetch of all on-chain data.
 */
import type { Protocol, AssetSymbol, YieldVault, ChainName } from '../types';
/**
 * Fetch (or return cached) APYs for every vault registered in the vault store.
 *
 * @returns Map from protocol name → APY decimal for the highest-APY vault of
 *          that protocol (useful for aggregate dashboards).
 */
export declare function fetchAllApys(): Promise<Map<Protocol, number>>;
/**
 * Find the vault offering the highest APY for a given asset, subject to
 * optional filters.
 *
 * @param asset      The stablecoin symbol to search for.
 * @param minApy     Only consider vaults with APY ≥ minApy.
 * @param riskLevel  Only consider vaults at or below this risk level.
 * @param chains     Restrict to specific chains.
 */
export declare function getBestVault(asset: AssetSymbol, minApy?: number, riskLevel?: 'low' | 'medium' | 'high', chains?: ChainName[]): Promise<YieldVault | null>;
/**
 * Return the cached APY for a single vault.
 * Returns null if not yet fetched.
 */
export declare function getCachedApy(vaultId: string): number | null;
/**
 * Force-invalidate the APY cache for all vaults (useful after config changes).
 */
export declare function invalidateApyCache(): void;
//# sourceMappingURL=apyAggregator.d.ts.map