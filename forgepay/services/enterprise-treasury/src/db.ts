/**
 * PostgreSQL pool + migrations for Enterprise Treasury.
 *
 * Tables:
 *   treasury_rules        — persisted rule definitions
 *   treasury_executions   — immutable execution log (rules + approvals)
 *   treasury_approvals    — approval queue with resolution tracking
 *   netting_flows         — pending intercompany payment flows
 *   netting_settlements   — settled batch records (audit trail)
 */

import { Pool } from 'pg';

// SECURITY: the dev connection string (well-known password) must never reach production.
if (!process.env['DATABASE_URL'] && process.env['NODE_ENV'] === 'production') {
  throw new Error('[enterprise-treasury] DATABASE_URL env var is required in production');
}

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,
});

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS treasury_rules (
        id              TEXT        PRIMARY KEY,
        name            TEXT        NOT NULL,
        enabled         BOOLEAN     NOT NULL DEFAULT true,
        condition       JSONB       NOT NULL,
        action          JSONB       NOT NULL,
        approval_required BOOLEAN   NOT NULL DEFAULT false,
        execution_count INT         NOT NULL DEFAULT 0,
        last_triggered  TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS treasury_executions (
        id           TEXT        PRIMARY KEY,
        rule_id      TEXT        NOT NULL,
        rule_name    TEXT        NOT NULL,
        result       TEXT        NOT NULL,
        action_type  TEXT        NOT NULL,
        detail       JSONB,
        executed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_treasury_exec_rule ON treasury_executions(rule_id);
      CREATE INDEX IF NOT EXISTS idx_treasury_exec_at   ON treasury_executions(executed_at DESC);

      CREATE TABLE IF NOT EXISTS treasury_approvals (
        id           TEXT        PRIMARY KEY,
        rule_id      TEXT        NOT NULL,
        rule_name    TEXT        NOT NULL,
        action       JSONB       NOT NULL,
        requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        resolved_at  TIMESTAMPTZ,
        resolved_by  TEXT,
        approved     BOOLEAN
      );
      CREATE INDEX IF NOT EXISTS idx_treasury_approvals_unresolved
        ON treasury_approvals(resolved_at)
        WHERE resolved_at IS NULL;

      CREATE TABLE IF NOT EXISTS netting_flows (
        id               TEXT        PRIMARY KEY,
        from_subsidiary  TEXT        NOT NULL,
        to_subsidiary    TEXT        NOT NULL,
        amount_usd       NUMERIC(20,2) NOT NULL,
        currency         TEXT        NOT NULL DEFAULT 'USD',
        invoice_ref      TEXT,
        due_date         DATE        NOT NULL,
        settled          BOOLEAN     NOT NULL DEFAULT false,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_netting_flows_unsettled
        ON netting_flows(settled)
        WHERE settled = false;

      CREATE TABLE IF NOT EXISTS netting_settlements (
        id               TEXT        PRIMARY KEY,
        total_gross_usd  NUMERIC(20,2),
        total_net_usd    NUMERIC(20,2),
        fees_saved_usd   NUMERIC(20,2),
        flow_count       INT,
        instructions     JSONB,
        settled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}
