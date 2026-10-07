/**
 * Durable state for the Bank White-Label Module.
 *
 * Banks, their admins, customers, transactions and the audit log lived only in memory, so a restart lost all of it, including
 * the day's transactions that the daily-limit check reads (limits reset on every deploy) and the record of what admins did.
 * Now each change is written through to Postgres and everything is loaded back at start.
 *
 * Configure with DATABASE_URL or DB_HOST. With neither it runs in memory (development); in production it refuses to start
 * without one. A write that fails after its retries is counted (persistenceFailures, on /health), never silent. A crash in the
 * milliseconds before a write lands can still drop that one record.
 *
 * Known limits: all rows are loaded into memory at start (fine at pilot scale; transactions will need paging later), and a
 * bank's webhook signing key is stored as the bank holds it (it must be recoverable to sign), so encrypt the database volume.
 */
export declare function isDbEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function assertPersistenceConfigured(env?: NodeJS.ProcessEnv): void;
export declare const persistenceFailures: () => number;
export declare function closePool(): Promise<void>;
export declare function runMigrations(): Promise<void>;
/** Migrate, load everything back into memory, and start writing changes through. Call before listening. */
export declare function initPersistence(): Promise<void>;
/** Test helper. */
export declare function detachPersistence(): void;
//# sourceMappingURL=persistence.d.ts.map