/**
 * PostgreSQL pool + migrations for Agent Liquidity Manager.
 *
 * Like the other ForgePay TypeScript services (see forge-custody/src/db.ts,
 * enterprise-treasury/src/db.ts), the in-memory store in store.ts is the
 * source of truth for a running instance and Postgres is best-effort
 * persistence: writes are fire-and-forget once migrations have succeeded.
 * Tests never need a reachable Postgres — persistAsync() is a no-op until
 * runMigrations() has completed.
 *
 * Table: agent_wallets — one row per AgentWallet, assets stored as JSONB.
 */

import { Pool } from 'pg';
import { logger } from './lib/logger';

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,
});

let dbReady = false;

/** True once runMigrations() has completed successfully. */
export function isDbReady(): boolean {
  return dbReady;
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_wallets (
        wallet_id  TEXT        PRIMARY KEY,
        agent_id   TEXT        NOT NULL,
        chain      TEXT        NOT NULL,
        address    TEXT        NOT NULL,
        assets     JSONB       NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_wallets_agent
        ON agent_wallets(agent_id);
    `);
    dbReady = true;
  } finally {
    client.release();
  }
}

/**
 * Fire-and-forget persistence. No-op until migrations have run so the
 * service (and the test suite) work fully in-memory without a reachable
 * Postgres.
 */
export function persistAsync(sql: string, params: unknown[]): void {
  if (!dbReady) return;
  pool.query(sql, params).catch((err: Error) => {
    logger.warn({ err, sql: sql.slice(0, 80) }, '[alm] best-effort persistence failed');
  });
}

/** Test/dev helper — forces persistAsync back to a no-op. */
export function _setDbReadyForTests(ready: boolean): void {
  dbReady = ready;
}
