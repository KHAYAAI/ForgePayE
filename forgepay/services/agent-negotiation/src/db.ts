import { Pool } from 'pg';

// SECURITY: the dev connection string (well-known password) must never reach production.
if (!process.env['DATABASE_URL'] && process.env['NODE_ENV'] === 'production') {
  throw new Error('[agent-negotiation] DATABASE_URL env var is required in production');
}

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,
});

let ledgerDbReady = false;

/** True once runMigrations() has completed successfully — gates persistAsync(). */
export function isLedgerDbReady(): boolean {
  return ledgerDbReady;
}

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS negotiation_sessions (
        id TEXT PRIMARY KEY,
        initiator_agent_id TEXT NOT NULL,
        responder_agent_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        messages JSONB NOT NULL DEFAULT '[]',
        agreed_terms JSONB,
        escrow_id TEXT,
        total_rounds INT NOT NULL DEFAULT 0,
        max_rounds INT NOT NULL DEFAULT 10,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        settlement_tx_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_neg_initiator ON negotiation_sessions(initiator_agent_id);
      CREATE INDEX IF NOT EXISTS idx_neg_responder ON negotiation_sessions(responder_agent_id);
      CREATE INDEX IF NOT EXISTS idx_neg_status ON negotiation_sessions(status);

      CREATE TABLE IF NOT EXISTS negotiation_escrows (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES negotiation_sessions(id) ON DELETE CASCADE,
        buyer_agent_id TEXT NOT NULL,
        seller_agent_id TEXT NOT NULL,
        amount_usd NUMERIC(20,2) NOT NULL,
        asset TEXT NOT NULL DEFAULT 'USDC',
        chain TEXT NOT NULL DEFAULT 'base',
        status TEXT NOT NULL DEFAULT 'pending',
        contract_address TEXT,
        tx_hash TEXT,
        funded_at TIMESTAMPTZ,
        released_at TIMESTAMPTZ,
        refunded_at TIMESTAMPTZ,
        dispute_reason TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_escrow_session ON negotiation_escrows(session_id);

      -- Escrow ledger: real internal per-agent balance accounting (see ledger.ts).
      -- In-memory Maps are the source of truth for a running instance; these
      -- tables are best-effort mirrors written fire-and-forget via persistAsync().
      CREATE TABLE IF NOT EXISTS negotiation_agent_balances (
        agent_id TEXT PRIMARY KEY,
        balance_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS negotiation_ledger_entries (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        escrow_id TEXT,
        from_agent_id TEXT,
        to_agent_id TEXT,
        amount_usd NUMERIC(20,2) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ledger_escrow ON negotiation_ledger_entries(escrow_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_from_agent ON negotiation_ledger_entries(from_agent_id);
      CREATE INDEX IF NOT EXISTS idx_ledger_to_agent ON negotiation_ledger_entries(to_agent_id);
    `);
    ledgerDbReady = true;
  } finally {
    client.release();
  }
}

/**
 * Fire-and-forget persistence for the escrow ledger, matching the idiom used
 * by forge-custody and enterprise-treasury: a no-op until migrations have
 * succeeded, so the service (and the test suite) work fully in-memory without
 * a reachable Postgres. Failures are logged, never thrown — the in-memory
 * ledger Maps remain the source of truth for a running instance.
 */
export function persistAsync(sql: string, params: unknown[]): void {
  if (!ledgerDbReady) return;
  pool.query(sql, params).catch((err) => {
    console.warn('[agent-negotiation] best-effort ledger persistence failed:', (err as Error).message);
  });
}
