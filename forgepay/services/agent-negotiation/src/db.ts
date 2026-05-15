import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://forgepay:devpassword@localhost:5432/forgepay_dev',
  max: 10,
});

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
    `);
  } finally {
    client.release();
  }
}
