/**
 * PostgreSQL pool + migrations for FORGE Custody.
 *
 * Schema: forge_custody
 * Tables:
 *   migrations         — applied migration ledger
 *   workspaces         — one row per bank/institution tenant
 *   api_keys           — sha256-hashed API keys (raw keys are never stored)
 *   policies           — per-workspace policy engine rules (JSONB)
 *   keys               — threshold-key metadata; encrypted shares live in Vault
 *                        (vault_path reference only — NEVER key material)
 *   ceremonies         — DKG ceremony records with Feldman VSS commitment hashes
 *   signing_requests   — signing lifecycle records
 *   signing_approvals  — distinct approver sign-offs
 *   signing_shares     — MPC share contribution hashes per signing
 *   audit_log          — append-only; this service never UPDATEs or DELETEs rows
 *
 * Like the other ForgePay TypeScript services, the in-memory store is the
 * source of truth for a running instance and Postgres is best-effort
 * persistence: writes are fire-and-forget once migrations have succeeded.
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

interface Migration {
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_initial_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS forge_custody.workspaces (
        id               TEXT        PRIMARY KEY,
        name             TEXT        NOT NULL,
        institution_type TEXT        NOT NULL DEFAULT 'bank',
        status           TEXT        NOT NULL DEFAULT 'active',
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS forge_custody.api_keys (
        id           TEXT        PRIMARY KEY,
        workspace_id TEXT        NOT NULL REFERENCES forge_custody.workspaces(id),
        key_hash     TEXT        NOT NULL UNIQUE,
        name         TEXT        NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at   TIMESTAMPTZ,
        last_used_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_custody_api_keys_hash
        ON forge_custody.api_keys(key_hash);
      CREATE INDEX IF NOT EXISTS idx_custody_api_keys_workspace
        ON forge_custody.api_keys(workspace_id);

      CREATE TABLE IF NOT EXISTS forge_custody.policies (
        id           TEXT        PRIMARY KEY,
        workspace_id TEXT        NOT NULL REFERENCES forge_custody.workspaces(id),
        name         TEXT        NOT NULL,
        enabled      BOOLEAN     NOT NULL DEFAULT true,
        rules        JSONB       NOT NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_custody_policies_workspace
        ON forge_custody.policies(workspace_id)
        WHERE enabled = true;

      CREATE TABLE IF NOT EXISTS forge_custody.keys (
        id              TEXT        PRIMARY KEY,
        workspace_id    TEXT        NOT NULL REFERENCES forge_custody.workspaces(id),
        blockchain      TEXT        NOT NULL,
        public_key      TEXT        NOT NULL,
        address         TEXT        NOT NULL,
        total_shares    INT         NOT NULL DEFAULT 7,
        threshold       INT         NOT NULL DEFAULT 4,
        share_holders   JSONB       NOT NULL DEFAULT '[]',
        vault_path      TEXT        NOT NULL,
        rotation_status TEXT        NOT NULL DEFAULT 'active',
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_custody_keys_workspace
        ON forge_custody.keys(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_custody_keys_address
        ON forge_custody.keys(address);

      CREATE TABLE IF NOT EXISTS forge_custody.ceremonies (
        id                    TEXT        PRIMARY KEY,
        workspace_id          TEXT        NOT NULL REFERENCES forge_custody.workspaces(id),
        ceremony_type         TEXT        NOT NULL DEFAULT 'dkg',
        participants          JSONB       NOT NULL,
        vss_commitments       JSONB       NOT NULL,
        commitments_verified  BOOLEAN     NOT NULL DEFAULT false,
        key_id                TEXT,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_custody_ceremonies_workspace
        ON forge_custody.ceremonies(workspace_id);

      CREATE TABLE IF NOT EXISTS forge_custody.signing_requests (
        id                 TEXT           PRIMARY KEY,
        workspace_id       TEXT           NOT NULL REFERENCES forge_custody.workspaces(id),
        customer_id        TEXT           NOT NULL,
        key_id             TEXT           NOT NULL,
        blockchain         TEXT           NOT NULL,
        transaction        JSONB          NOT NULL,
        metadata           JSONB          NOT NULL DEFAULT '{}',
        amount_usd         NUMERIC(20,2)  NOT NULL DEFAULT 0,
        status             TEXT           NOT NULL,
        reason_code        TEXT,
        approvals_required INT            NOT NULL DEFAULT 0,
        approver_roles     JSONB          NOT NULL DEFAULT '[]',
        signature          TEXT,
        tx_hash            TEXT,
        block_number       BIGINT,
        confirmation_time  TIMESTAMPTZ,
        error              TEXT,
        created_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ    NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_custody_signing_workspace_created
        ON forge_custody.signing_requests(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_custody_signing_status
        ON forge_custody.signing_requests(status);
      CREATE INDEX IF NOT EXISTS idx_custody_signing_tx_hash
        ON forge_custody.signing_requests(tx_hash)
        WHERE tx_hash IS NOT NULL;

      CREATE TABLE IF NOT EXISTS forge_custody.signing_approvals (
        id                 TEXT        PRIMARY KEY,
        signing_request_id TEXT        NOT NULL REFERENCES forge_custody.signing_requests(id),
        approver_id        TEXT        NOT NULL,
        approver_role      TEXT        NOT NULL,
        approved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (signing_request_id, approver_id)
      );
      CREATE INDEX IF NOT EXISTS idx_custody_approvals_request
        ON forge_custody.signing_approvals(signing_request_id);

      CREATE TABLE IF NOT EXISTS forge_custody.signing_shares (
        id                 TEXT        PRIMARY KEY,
        signing_request_id TEXT        NOT NULL REFERENCES forge_custody.signing_requests(id),
        share_index        INT         NOT NULL,
        holder             TEXT        NOT NULL,
        contribution_hash  TEXT        NOT NULL,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (signing_request_id, share_index)
      );
      CREATE INDEX IF NOT EXISTS idx_custody_shares_request
        ON forge_custody.signing_shares(signing_request_id);

      CREATE TABLE IF NOT EXISTS forge_custody.audit_log (
        id           TEXT        PRIMARY KEY,
        workspace_id TEXT,
        api_key_id   TEXT,
        actor        TEXT        NOT NULL,
        method       TEXT        NOT NULL,
        path         TEXT        NOT NULL,
        action       TEXT        NOT NULL,
        resource_id  TEXT,
        status_code  INT,
        detail       JSONB,
        ip           TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_custody_audit_workspace_created
        ON forge_custody.audit_log(workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_custody_audit_resource
        ON forge_custody.audit_log(resource_id)
        WHERE resource_id IS NOT NULL;
    `,
  },
];

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS forge_custody;`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id         SERIAL      PRIMARY KEY,
        name       TEXT        NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    for (const migration of MIGRATIONS) {
      const applied = await client.query(`SELECT 1 FROM migrations WHERE name = $1`, [
        `forge_custody/${migration.name}`,
      ]);
      if (applied.rowCount && applied.rowCount > 0) continue;

      try {
        await client.query('BEGIN');
        await client.query(migration.sql);
        await client.query(`INSERT INTO migrations (name) VALUES ($1)`, [
          `forge_custody/${migration.name}`,
        ]);
        await client.query('COMMIT');
        logger.info({ migration: migration.name }, '[custody] migration applied');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    dbReady = true;
  } finally {
    client.release();
  }
}

/**
 * Fire-and-forget persistence. No-op until migrations have run so the service
 * (and the test suite) work fully in-memory without a reachable Postgres.
 */
export function persistAsync(sql: string, params: unknown[]): void {
  if (!dbReady) return;
  pool.query(sql, params).catch((err) => {
    logger.warn({ err, sql: sql.slice(0, 80) }, '[custody] best-effort persistence failed');
  });
}
