/**
 * PostgreSQL pool + migrations for Agent Credit Lines.
 *
 * Tables:
 *   credit_lines    — revolving credit line definitions
 *   credit_draws    — individual draws against a line
 *   credit_defaults — default records with loss tracking
 */

import { Pool, PoolClient } from 'pg';

/**
 * Self-contained by necessity: this used to delegate to the shared
 * ../../lib/db.ts at the monorepo root, but this service's Dockerfile only
 * `COPY src/ ./src/` — that root lib is unreachable at build time (the
 * import resolved to nothing and `tsc` failed with TS2307). Inlined here
 * instead, mirroring forgepay/services/unified-router/src/lib/db.ts.
 */
function createDbPool(): Pool {
  const pool = new Pool({
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
    user: process.env['DB_USER'] ?? 'postgres',
    password: process.env['DB_PASSWORD'] ?? 'postgres',
    database: process.env['DB_NAME'] ?? 'forgepay',
    max: Math.max(1, parseInt(process.env['DB_POOL_MAX'] ?? '20', 10)),
    min: Math.max(0, parseInt(process.env['DB_POOL_MIN'] ?? '2', 10)),
    idleTimeoutMillis: Math.max(0, parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '30000', 10)),
    connectionTimeoutMillis: Math.max(0, parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000', 10)),
  });

  pool.on('error', (err: Error, _client: PoolClient) => {
    console.error('[agent-credit-lines] unhandled error in PostgreSQL pool', err);
  });

  return pool;
}

export const pool = createDbPool();

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS credit_lines (
        id                TEXT        PRIMARY KEY,
        agent_id          TEXT        NOT NULL,
        limit_usd         NUMERIC(20,2) NOT NULL,
        available_usd     NUMERIC(20,2) NOT NULL,
        used_usd          NUMERIC(20,2) NOT NULL DEFAULT 0,
        terms_days        INT         NOT NULL,
        interest_rate_bps INT         NOT NULL,
        status            TEXT        NOT NULL DEFAULT 'active',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_credit_lines_agent ON credit_lines(agent_id);
      CREATE INDEX IF NOT EXISTS idx_credit_lines_status ON credit_lines(status);

      CREATE TABLE IF NOT EXISTS credit_draws (
        id                   TEXT        PRIMARY KEY,
        credit_line_id       TEXT        NOT NULL REFERENCES credit_lines(id) ON DELETE CASCADE,
        agent_id             TEXT        NOT NULL,
        amount_usd           NUMERIC(20,2) NOT NULL,
        total_owed_usd       NUMERIC(20,2) NOT NULL,
        repaid_usd           NUMERIC(20,2) NOT NULL DEFAULT 0,
        drawn_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        due_at               TIMESTAMPTZ NOT NULL,
        repaid_at            TIMESTAMPTZ,
        status               TEXT        NOT NULL DEFAULT 'outstanding',
        purpose              TEXT        NOT NULL,
        counterparty_agent_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_credit_draws_line   ON credit_draws(credit_line_id);
      CREATE INDEX IF NOT EXISTS idx_credit_draws_agent  ON credit_draws(agent_id);
      CREATE INDEX IF NOT EXISTS idx_credit_draws_status ON credit_draws(status);
      CREATE INDEX IF NOT EXISTS idx_credit_draws_due    ON credit_draws(due_at)
        WHERE status IN ('outstanding', 'overdue');

      CREATE TABLE IF NOT EXISTS credit_defaults (
        draw_id              TEXT        NOT NULL,
        agent_id             TEXT        NOT NULL,
        defaulted_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        recovered_amount_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
        loss_usd             NUMERIC(20,2) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_credit_defaults_agent ON credit_defaults(agent_id);
    `);
  } finally {
    client.release();
  }
}
