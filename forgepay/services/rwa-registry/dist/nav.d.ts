/**
 * Get NAV price for an asset.
 * Try CoinGecko API first, fall back to cached price if API fails.
 */
export declare function getNAVPrice(symbol: string): Promise<number | null>;
/**
 * Refresh NAVs for all assets using CoinGecko real-time prices.
 *
 * Strategy:
 *   1. Try CoinGecko API first (free tier, no auth)
 *   2. Cache successful prices in PostgreSQL (1-hour TTL)
 *   3. Fall back to cached price if API fails or rate-limited
 *   4. Log failures but don't crash the background job
 */
export declare function refreshAllNAVs(): Promise<void>;
/**
 * Returns all active RWA assets sorted by APY descending — useful for
 * yield comparison / recommendation engine.
 */
export declare function getYieldComparison(): Array<{
    assetId: string;
    name: string;
    symbol: string;
    apyBps: number;
    apyPercent: string;
    redemptionSpeed: string;
    minimumUsd: number;
    chain: string | undefined;
    issuer: string;
    requiresAccredited: boolean;
}>;
//# sourceMappingURL=nav.d.ts.map