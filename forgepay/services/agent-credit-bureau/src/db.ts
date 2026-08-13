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
  BillingAccount,
  BillingTransaction,
  TopUpReceipt,
} from './types';
import type { SettlementReceipt } from './settlement';
import type { LenderReport } from './lender-report';

// ── Enablement ────────────────────────────────────────────────────────────────

/**
 * True only if DATABASE_URL or DB_HOST is explicitly set in the environment.
 * When false, persistence is skipped entirely and the store runs in-memory
 * exactly as it did before (offline/demo behavior preserved).
 */
export function isDbEnabled(): boolean {
  return !!(process.env['DATABASE_URL'] || process.env['DB_HOST']);
}

/**
 * Refuse to boot in production with no database configured.
 *
 * Every other production credential in this service (BUREAU_ADMIN_API_KEY,
 * CONSENT_SIGNING_SECRET) already fails closed at startup rather than
 * degrading silently — persistence was the one exception. Unlike those,
 * `isDbEnabled() === false` is not a misconfiguration you'd notice from a
 * missing-secret error: the service boots, serves traffic, looks correct,
 * and then a restart silently drops every profile, score, dispute and
 * billing transaction and reseeds five demo agents in their place. That is
 * a worse failure mode than refusing to start.
 *
 * @throws in production when neither DATABASE_URL nor DB_HOST is set.
 */
export function assertPersistenceConfigured(): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  if (isDbEnabled()) return;

  throw new Error(
    'Neither DATABASE_URL nor DB_HOST is set. The credit bureau refuses to start in ' +
    'production without persistence — without it, every profile, score, dispute and ' +
    'billing transaction lives only in memory and is lost on the next restart.',
  );
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
        -- The EVM account this agent settles from, EIP-55 checksummed. Held as
        -- a column (not only inside the JSONB blob) so operators can query
        -- "which agents cannot settle" without scanning JSON.
        evm_address TEXT,
        operator_entity_id TEXT NOT NULL,
        operator_entity_type TEXT NOT NULL,
        current_score INT NOT NULL DEFAULT 0,
        tier TEXT NOT NULL,
        frozen_at TIMESTAMPTZ,
        profile JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Added after the initial schema; idempotent so redeploys are safe.
      ALTER TABLE agent_credit_profiles ADD COLUMN IF NOT EXISTS evm_address TEXT;

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

      -- Lender reports are the underwriting packets issued to third-party
      -- lenders. Held separately from credit_reports because they are a
      -- different product with a different shape, and because a lender that
      -- made a credit decision on one must be able to retrieve exactly the
      -- document it decided on — regenerating it later would score against a
      -- profile that has since moved.
      CREATE TABLE IF NOT EXISTS lender_reports (
        report_id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        requestor_id TEXT NOT NULL,
        outcome TEXT,
        generated_at TIMESTAMPTZ,
        expires_at TIMESTAMPTZ,
        report JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_lender_reports_agent_id
        ON lender_reports(agent_id);

      -- A lender pulling its own issued-report history is the common query.
      CREATE INDEX IF NOT EXISTS idx_lender_reports_requestor_id
        ON lender_reports(requestor_id);

      CREATE TABLE IF NOT EXISTS data_contributors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        -- Holds the sha256 of the issued key, never the key itself.
        api_key TEXT NOT NULL,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Added with the activation lifecycle; idempotent so redeploys are safe.
      -- A queryable column so an operator can list who is pending approval
      -- without scanning the JSONB blob.
      ALTER TABLE data_contributors ADD COLUMN IF NOT EXISTS status TEXT;
      CREATE INDEX IF NOT EXISTS idx_data_contributors_status
        ON data_contributors(status);

      CREATE TABLE IF NOT EXISTS settlement_receipts (
        agent_id TEXT PRIMARY KEY,
        tx_hash TEXT NOT NULL,
        block_number BIGINT,
        chain_id INT,
        settled_at TIMESTAMPTZ,
        receipt JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Prepaid billing ledger. Balances are held in integer USD cents
      -- (balance_usd_cents) to avoid floating-point drift on money.
      CREATE TABLE IF NOT EXISTS billing_accounts (
        requestor_id TEXT PRIMARY KEY,
        balance_usd_cents BIGINT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Append-only. Every credit and debit against a billing account,
      -- including the running balance immediately after, so the ledger can
      -- be reconciled independently of the account row.
      CREATE TABLE IF NOT EXISTS billing_transactions (
        id TEXT PRIMARY KEY,
        requestor_id TEXT NOT NULL,
        type TEXT NOT NULL,
        amount_usd_cents BIGINT NOT NULL,
        balance_after_usd_cents BIGINT NOT NULL,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_billing_transactions_requestor_id
        ON billing_transactions(requestor_id);

      -- x402 USDC top-ups in flight against stablecoin-gateway. Persisted so a
      -- confirm call is idempotent across restarts, not just within a process.
      CREATE TABLE IF NOT EXISTS billing_topups (
        receipt_id TEXT PRIMARY KEY,
        requestor_id TEXT NOT NULL,
        amount_usd_cents BIGINT NOT NULL,
        status TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        confirmed_at TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_billing_topups_requestor_id
        ON billing_topups(requestor_id);
    `);
  } finally {
    client.release();
  }
}

// ── Repository: credit profiles ────────────────────────────────────────────────

export async function upsertProfile(p: AgentCreditProfile): Promise<void> {
  await pool.query(
    `INSERT INTO agent_credit_profiles
       (agent_id, did, evm_address, operator_entity_id, operator_entity_type,
        current_score, tier, frozen_at, profile, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
     ON CONFLICT (agent_id) DO UPDATE SET
       did = EXCLUDED.did,
       evm_address = EXCLUDED.evm_address,
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
      p.evmAddress ?? null,
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

// ── Repository: lender reports ─────────────────────────────────────────────────

export async function upsertLenderReport(r: LenderReport): Promise<void> {
  await pool.query(
    `INSERT INTO lender_reports
       (report_id, agent_id, requestor_id, outcome, generated_at, expires_at, report, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (report_id) DO UPDATE SET
       agent_id = EXCLUDED.agent_id,
       requestor_id = EXCLUDED.requestor_id,
       outcome = EXCLUDED.outcome,
       generated_at = EXCLUDED.generated_at,
       expires_at = EXCLUDED.expires_at,
       report = EXCLUDED.report,
       updated_at = NOW()`,
    [
      r.reportId, r.agentId, r.requestorId, r.decision.outcome,
      r.generatedAt ?? null, r.expiresAt ?? null, JSON.stringify(r),
    ],
  );
}

export async function loadAllLenderReports(): Promise<LenderReport[]> {
  const res = await pool.query<{ report: LenderReport }>(`SELECT report FROM lender_reports`);
  return res.rows.map((r) => r.report);
}

// ── Repository: data contributors ──────────────────────────────────────────────

export async function upsertContributor(c: DataContributor): Promise<void> {
  await pool.query(
    `INSERT INTO data_contributors (id, name, type, api_key, status, data, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       type = EXCLUDED.type,
       api_key = EXCLUDED.api_key,
       status = EXCLUDED.status,
       data = EXCLUDED.data,
       updated_at = NOW()`,
    // `api_key` stores the sha256 of the issued key, never the key itself.
    // Column name kept to avoid a migration on an existing table.
    [c.id, c.name, c.type, c.apiKeyHash, c.status, JSON.stringify(c)],
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

// ── Repository: billing ────────────────────────────────────────────────────────

export async function upsertBillingAccount(a: BillingAccount): Promise<void> {
  await pool.query(
    `INSERT INTO billing_accounts (requestor_id, balance_usd_cents, created_at, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (requestor_id) DO UPDATE SET
       balance_usd_cents = EXCLUDED.balance_usd_cents,
       updated_at = NOW()`,
    [a.requestorId, a.balanceUsdCents, a.createdAt],
  );
}

export async function loadAllBillingAccounts(): Promise<BillingAccount[]> {
  const res = await pool.query<{
    requestor_id: string; balance_usd_cents: string; created_at: Date; updated_at: Date;
  }>(`SELECT requestor_id, balance_usd_cents, created_at, updated_at FROM billing_accounts`);
  return res.rows.map((r) => ({
    requestorId:     r.requestor_id,
    balanceUsdCents: Number(r.balance_usd_cents),
    createdAt:       r.created_at.toISOString(),
    updatedAt:       r.updated_at.toISOString(),
  }));
}

// Append-only — no ON CONFLICT DO UPDATE. A transaction id is a random UUID
// minted once per credit/debit, so a conflict here would mean the same
// ledger entry was written twice, which should surface as an error rather
// than silently overwrite.
export async function upsertBillingTransaction(t: BillingTransaction): Promise<void> {
  await pool.query(
    `INSERT INTO billing_transactions
       (id, requestor_id, type, amount_usd_cents, balance_after_usd_cents, reason, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO NOTHING`,
    [t.id, t.requestorId, t.type, t.amountUsdCents, t.balanceAfterUsdCents, t.reason, t.createdAt],
  );
}

export async function loadAllBillingTransactions(): Promise<BillingTransaction[]> {
  const res = await pool.query<{
    id: string; requestor_id: string; type: string; amount_usd_cents: string;
    balance_after_usd_cents: string; reason: string; created_at: Date;
  }>(`SELECT id, requestor_id, type, amount_usd_cents, balance_after_usd_cents, reason, created_at
        FROM billing_transactions`);
  return res.rows.map((r) => ({
    id:                    r.id,
    requestorId:           r.requestor_id,
    type:                  r.type as BillingTransaction['type'],
    amountUsdCents:        Number(r.amount_usd_cents),
    balanceAfterUsdCents:  Number(r.balance_after_usd_cents),
    reason:                r.reason,
    createdAt:             r.created_at.toISOString(),
  }));
}

export async function upsertTopUpReceipt(r: TopUpReceipt): Promise<void> {
  await pool.query(
    `INSERT INTO billing_topups
       (receipt_id, requestor_id, amount_usd_cents, status, created_at, confirmed_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (receipt_id) DO UPDATE SET
       status = EXCLUDED.status,
       confirmed_at = EXCLUDED.confirmed_at`,
    [r.receiptId, r.requestorId, Math.round(r.amountUsd * 100), r.status, r.createdAt, r.confirmedAt ?? null],
  );
}

export async function loadAllTopUpReceipts(): Promise<TopUpReceipt[]> {
  const res = await pool.query<{
    receipt_id: string; requestor_id: string; amount_usd_cents: string;
    status: string; created_at: Date; confirmed_at: Date | null;
  }>(`SELECT receipt_id, requestor_id, amount_usd_cents, status, created_at, confirmed_at
        FROM billing_topups`);
  return res.rows.map((r) => ({
    receiptId:   r.receipt_id,
    requestorId: r.requestor_id,
    amountUsd:   Number(r.amount_usd_cents) / 100,
    status:      r.status as TopUpReceipt['status'],
    createdAt:   r.created_at.toISOString(),
    confirmedAt: r.confirmed_at ? r.confirmed_at.toISOString() : undefined,
  }));
}
