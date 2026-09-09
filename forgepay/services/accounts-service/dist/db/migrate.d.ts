/**
 * DB Migration Runner — accounts-service
 *
 * Reads all *.sql files from src/db/migrations/ in alphabetical order and
 * applies any that have not yet been recorded in the accounts_service_migrations
 * tracking table.  Idempotent — safe to run on every startup.
 */
import type { Pool } from 'pg';
/**
 * Main entry point.  Call once during service startup before any DB queries.
 *
 * @param db  Shared pg.Pool instance.
 */
export declare function runMigrations(db: Pool): Promise<void>;
//# sourceMappingURL=migrate.d.ts.map