/**
 * PostgreSQL Connection Pool, Migrations, and Repository Helpers
 * ──────────────────────────────────────────────────────────────────────────
 * Gives the Agent Credit Bureau real persistence so credit data survives a
 * pod restart, WITHOUT an async refactor of the request hot path.
 *
 * Pattern: hydrate-on-boot + write-through.
 *   - The in-memory Maps in store.ts remain the synchronous read model.
 *   - Each mutator fires a fire-and-forget write-through to Postgres.
 *   - On boot, the Maps are hydrated from Postgres (see store.initPersistence).
 *
 * Mirrors the established pattern in services/agent-identity/src/db.ts:
 * inline `new Pool(...)` from 'pg' reading discrete DB_* env vars, plus an
 * idempotent `runMigrations()` using CREATE TABLE IF NOT EXISTS.
 *
 * Persistence is OPT-IN: it only activates when DATABASE_URL or DB_HOST is
 * explicitly set in the environment (see isDbEnabled). Local/offline/demo
 * runs with no DB configured skip persistence entirely and stay in-memory.
 */

import { Pool, PoolClient } from 'pg';
import type {
  AgentCreditProfile,
  Dispute,
  CreditReport,
  DataContributor,
} from './types';
import type { SettlementReceipt } from './settlement';

// ── Enablement ────────────────────────────────────────────────────────────────

/**
 * True only if DATABASE_URL or DB_HOST is explicitly set in the environment.
 * When false, persistence is skipped entirely and the store runs in-memory
 * exactly as it did before (offline/demo behavior preserved).
 */
export function isDbEnabled(): boolean {
  return !!(process.env['DATABASE_URL'] || process.env['DB_HOST']);
}

// ── Pool ──────────────────────────────────────────────────────────────────────

function createDbPool(): Pool {
  const connectionString = process.env['DATABASE_URL'];
  const common = {
    max: Math.max(1, parseInt(process.env['DB_POOL_MAX'] ?? '20', 10)),
    min: Math.max(0, parseInt(process.env['DB_POOL_MIN'] ?? '2', 10)),
    idleTimeoutMillis: Math.max(0, parseInt(process.env['DB_IDLE_TIMEOUT_MS'] ?? '30000', 10)),
    connectionTimeoutMillis: Math.max(0, parseInt(process.env['DB_STATEMENT_TIMEOUT_MS'] ?? '5000', 10)),
  };

  const pool = connectionString
    ? new Pool({ connectionString, ...common })
    : new Pool({
        host: process.env['DB_HOST'] ?? 'localhost',
        port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
        user: process.env['DB_USER'] ?? 'postgres',
        password: process.env['DB_PASSWORD'] ?? 'postgres',
        database: process.env['DB_NAME'] ?? 'forgepay',
        ...common,
      });

  pool.on('error', (err: Error, _client: PoolClient) => {
    console.error('[agent-credit-bureau] unhandled error in PostgreSQL pool', err);
  });

  return pool;
}

export const pool = createDbPool();

// ── Migrations ────────────────────────────────────────────────────────────────

/**
 * Run all database migrations. Called during service startup if the DB is
 * enabled. Uses CREATE TABLE IF NOT EXISTS for idempotency — can be run
 * multiple times safely.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      -- Full credit profile: scalar columns mirrored for querying, whole nested
      -- object stored in the JSONB column.
      CREATE TABLE IF NOT EXISTS agent_credit_profiles (
        agent_id TEXT PRIMARY KEY,
        did TEXT NOT NULL,
        operator_entity_id TEXT NOT NULL,
        operator_entity_type TEXT NOT NULL,
        current_score INT NOT NULL DEFAULT 0,
        tier TEXT NOT NULL,
        frozen_at TIMESTAMPTZ,
        profile JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_credit_profiles_current_score
        ON agent_credit_profiles(current_score);

      CREATE TABLE IF NOT EXISTS credit_disputes (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        status TEXT NOT NULL,
        filed_at TIMESTAMPTZ,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_credit_disputes_status
        ON credit_disputes(status);
      CREATE INDEX IF NOT EXISTS idx_credit_disputes_agent_id
        ON credit_disputes(agent_id);

      CREATE TABLE IF NOT EXISTS credit_reports (
        report_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        generated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        report JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_credit_reports_agent_id
        ON credit_reports(agent_id);

      CREATE TABLE IF NOT EXISTS data_contributors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        api_key TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settlement_receipts (
        agent_id TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        block_number BIGINT,
        chain_id INT,
        settled_at TIMESTAMPTZ,
        receipt JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
  } finally {
    client.release();
  }
}

// ── Repository: credit profiles ────────────────────────────────────────────────

export async function upsertProfile(p: AgentCreditProfile): Promise<void> {
  await pool.query(
    `INSERT INTO agent_credit_profiles
       (agent_id, did, operator_entity_id, operator_entity_type,
        current_score, tier, frozen_at, profile, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (agent_id) DO UPDATE SET
       did = EXCLUDED.did,
       operator_entity_id = EXCLUDED.operator_entity_id,
       operator_entity_type = EXCLUDED.operator_entity_type,
       current_score = EXCLUDED.current_score,
       tier = EXCLUDED.tier,
       frozen_at = EXCLUDED.frozen_at,
       profile = EXCLUDED.profile,
       updated_at = NOW()`,
    [
      p.agentId,
      p.did,
      p.operatorEntityId,
      p.operatorEntityType,
      p.currentScore,
      p.tier,
      p.frozenAt ?? null,
      JSON.stringify(p),
    ],
  );
}

export async function loadAllProfiles(): Promise<AgentCreditProfile[]> {
  const res = await pool.query<{ profile: AgentCreditProfile }>(
    `SELECT profile FROM agent_credit_profiles`,
  );
  return res.rows.map((r) => r.profile);
}

// ── Repository: disputes ───────────────────────────────────────────────────────

export async function upsertDispute(d: Dispute): Promise<void> {
  await pool.query(
    `INSERT INTO credit_disputes (id, agent_id, status, filed_at, data, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       status = EXCLUDED.status,
       filed_at = EXCLUDED.filed_at,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [d.id, d.agentId, d.status, d.filedAt ?? null, JSON.stringify(d)],
  );
}

export async function loadAllDisputes(): Promise<Dispute[]> {
  const res = await pool.query<{ data: Dispute }>(`SELECT data FROM credit_disputes`);
  return res.rows.map((r) => r.data);
}

// ── Repository: reports ────────────────────────────────────────────────────────

export async function upsertReport(r: CreditReport): Promise<void> {
  await pool.query(
    `INSERT INTO credit_reports (report_id, agent_id, generated_at, expires_at, report, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (report_id) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       generated_at = EXCLUDED.generated_at,
       expires_at = EXCLUDED.expires_at,
       report = EXCLUDED.report,
       updated_at = NOW()`,
    [r.reportId, r.agentId, r.generatedAt ?? null, r.expiresAt ?? null, JSON.stringify(r)],
  );
}

export async function loadAllReports(): Promise<CreditReport[]> {
  const res = await pool.query<{ report: CreditReport }>(`SELECT report FROM credit_reports`);
  return res.rows.map((r) => r.report);
}

// ── Repository: data contributors ──────────────────────────────────────────────

export async function upsertContributor(c: DataContributor): Promise<void> {
  await pool.query(
    `INSERT INTO data_contributors (id, name, type, api_key, data, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       api_key = EXCLUDED.api_key,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    [c.id, c.name, c.type, c.apiKey, JSON.stringify(c)],
  );
}

export async function loadAllContributors(): Promise<DataContributor[]> {
  const res = await pool.query<{ data: DataContributor }>(`SELECT data FROM data_contributors`);
  return res.rows.map((r) => r.data);
}

// ── Repository: settlement receipts ────────────────────────────────────────────

export async function upsertSettlement(
  agentId: string,
  receipt: SettlementReceipt,
): Promise<void> {
  await pool.query(
    `INSERT INTO settlement_receipts
       (agent_id, tx_hash, block_number, chain_id, settled_at, receipt, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (agent_id) DO UPDATE SET
       tx_hash = EXCLUDED.tx_hash,
       block_number = EXCLUDED.block_number,
       chain_id = EXCLUDED.chain_id,
       settled_at = EXCLUDED.settled_at,
       receipt = EXCLUDED.receipt,
       updated_at = NOW()`,
    [
      agentId,
      receipt.txHash,
      receipt.blockNumber,
      receipt.chainId,
      receipt.settledAt ?? null,
      JSON.stringify(receipt),
    ],
  );
}

export async function loadAllSettlements(): Promise<SettlementReceipt[]> {
  const res = await pool.query<{ receipt: SettlementReceipt }>(
    `SELECT receipt FROM settlement_receipts`,
  );
  return res.rows.map((r) => r.receipt);
}
