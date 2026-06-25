/**
 * PostgreSQL Connection Pool and Migrations
 * ──────────────────────────────────────────────────────────────────────────
 * Manages database connection pooling and schema initialization for agent
 * identities, reputation events, and attestations.
 */

import { Pool } from 'pg';
import { createDbPool } from '../../lib/db.js';

export const pool = createDbPool();

/**
 * Run all database migrations. Called during service startup if DATABASE_URL is set.
 * Uses CREATE TABLE IF NOT EXISTS for idempotency — can be run multiple times safely.
 */
export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Migration 001: Create agent identity tables with PostgreSQL persistence
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_identities (
        id TEXT PRIMARY KEY,
        did TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        framework TEXT NOT NULL,
        owner_merchant_id TEXT NOT NULL,
        capabilities JSONB NOT NULL DEFAULT '[]',
        trust_level TEXT NOT NULL DEFAULT 'basic',
        reputation_score INT NOT NULL DEFAULT 500,
        total_transactions INT NOT NULL DEFAULT 0,
        total_volume_usd NUMERIC(20,2) NOT NULL DEFAULT 0,
        success_rate NUMERIC(5,4) NOT NULL DEFAULT 1.0,
        average_response_time_ms INT NOT NULL DEFAULT 1000,
        tags JSONB NOT NULL DEFAULT '[]',
        metadata JSONB NOT NULL DEFAULT '{}',
        endpoint TEXT,
        public_key TEXT,
        webhook_url TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_agent_framework ON agent_identities(framework);
      CREATE INDEX IF NOT EXISTS idx_agent_trust_level ON agent_identities(trust_level);
      CREATE INDEX IF NOT EXISTS idx_agent_status ON agent_identities(status);

      -- Reputation events are immutable audit trail
      CREATE TABLE IF NOT EXISTS agent_reputation_events (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        score_delta INT NOT NULL,
        description TEXT,
        related_agent_id TEXT,
        transaction_id TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_rep_agent_id ON agent_reputation_events(agent_id);

      -- Attestations from issuers (agents or merchants) to subject agents
      CREATE TABLE IF NOT EXISTS agent_attestations (
        id TEXT PRIMARY KEY,
        issuer_agent_id TEXT,
        issuer_merchant_id TEXT NOT NULL,
        subject_agent_id TEXT NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
        claim TEXT NOT NULL,
        data JSONB NOT NULL DEFAULT '{}',
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_att_subject ON agent_attestations(subject_agent_id);

      -- KYAPay external identity columns (nullable — only set for imported agents)
      ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS kyapay_sub VARCHAR(255);
      ALTER TABLE agent_identities ADD COLUMN IF NOT EXISTS kyapay_iss VARCHAR(512);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_kyapay_sub_iss
        ON agent_identities(kyapay_sub, kyapay_iss)
        WHERE kyapay_sub IS NOT NULL AND kyapay_iss IS NOT NULL;
    `);
  } finally {
    client.release();
  }
}
