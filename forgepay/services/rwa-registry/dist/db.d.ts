/**
 * PostgreSQL pool + migrations for RWA Registry NAV cache.
 *
 * Tables:
 *   rwa_nav_cache     — cached NAV prices for RWA assets (1-hour TTL)
 */
import { Pool } from 'pg';
export declare const pool: Pool;
export declare function runMigrations(): Promise<void>;
/**
 * Get cached NAV price for an asset if it exists and is not expired.
 */
export declare function getCachedNAV(asset: string): Promise<number | null>;
/**
 * Cache a NAV price with a 1-hour TTL.
 */
export declare function cacheNAV(asset: string, priceUsd: number): Promise<void>;
/**
 * Get all cached NAVs (for initialization on startup).
 */
export declare function getAllCachedNAVs(): Promise<Record<string, number>>;
/**
 * Clear expired NAV cache entries.
 */
export declare function clearExpiredNAVs(): Promise<number>;
//# sourceMappingURL=db.d.ts.map