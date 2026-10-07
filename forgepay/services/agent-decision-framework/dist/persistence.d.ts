/**
 * Durable state for the decision framework.
 *
 * Policies, per-agent limits, the spend-velocity ledger and the decision log lived only in memory, so a restart:
 *  - reset every agent's rolling spend window, which makes a velocity limit a limit only until the next deploy;
 *  - dropped every policy and per-agent override an operator had set, restoring the defaults;
 *  - lost the decision history.
 *
 * Now they are written through to Postgres and loaded at start. The write is fire-and-forget with retries so the request path
 * stays synchronous; a write that fails after its retries is counted (see persistenceFailures, shown on /health) rather than lost
 * silently. A crash in the few milliseconds before a write lands can still drop that one record.
 *
 * Configure with DATABASE_URL or DB_HOST. With neither, the service runs in memory (development). In production it refuses to start
 * without one: a spend limit that forgets is not a limit.
 */
export declare function isDbEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function assertPersistenceConfigured(env?: NodeJS.ProcessEnv): void;
export declare const persistenceFailures: () => number;
export declare function closePool(): Promise<void>;
export declare function runMigrations(): Promise<void>;
/** Migrate, load everything back into memory, and start writing changes through. Call before listening. */
export declare function initPersistence(): Promise<void>;
/** Test helper: detach the sinks so a later test does not write to a closed pool. */
export declare function detachPersistence(): void;
//# sourceMappingURL=persistence.d.ts.map