/**
 * PostgreSQL Database Layer for yield-engine.
 *
 * Provides connection pooling and basic CRUD operations for persistent storage
 * of DeFi positions, sweep configs, and transactions.
 *
 * Uses the `pg` library (already available from Hyperswitch / ForgePay base).
 * Migrations run automatically on startup.
 */
import { Pool } from 'pg';
import type { YieldPosition, YieldTransaction, SweepConfig } from './types';
/**
 * Initialize the database connection pool.
 * Call this once during app startup.
 */
export declare function initDb(): Promise<void>;
/**
 * Close the database connection pool.
 * Call this during graceful shutdown.
 */
export declare function closeDb(): Promise<void>;
/**
 * Get a client from the pool for manual queries.
 * Remember to release it when done.
 */
export declare function getPool(): Pool;
/**
 * Persist a position to the database.
 * Uses UPSERT (ON CONFLICT DO UPDATE) for idempotency.
 */
export declare function upsertPosition(position: YieldPosition): Promise<void>;
/**
 * Load all positions from the database.
 * Called during startup to restore state from persistent storage.
 */
export declare function loadAllPositions(): Promise<YieldPosition[]>;
/**
 * Load a single position by ID.
 */
export declare function loadPositionById(id: string): Promise<YieldPosition | null>;
/**
 * Persist a transaction to the database.
 * Uses UPSERT for idempotency.
 */
export declare function upsertTransaction(tx: YieldTransaction): Promise<void>;
/**
 * Load all transactions for a merchant.
 */
export declare function loadTransactionsByMerchant(merchantId: string): Promise<YieldTransaction[]>;
/**
 * Persist a sweep config to the database.
 * Uses UPSERT for idempotency.
 */
export declare function upsertSweepConfig(config: SweepConfig): Promise<void>;
/**
 * Load all sweep configs from the database.
 */
export declare function loadAllSweepConfigs(): Promise<SweepConfig[]>;
//# sourceMappingURL=db.d.ts.map