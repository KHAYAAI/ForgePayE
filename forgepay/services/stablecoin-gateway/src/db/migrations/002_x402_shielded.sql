-- Migration 002: x402 shielded payment indexes and chain-event tracking columns
--
-- 001 created shielded_deposits with tx_hash and confirmed_at already present,
-- and x402_shielded_payments with the core nullifier/status columns. This
-- migration adds:
--   • tx_hash / confirmed_at to shielded_deposits (IF NOT EXISTS guard for
--     environments that ran an older schema without them)
--   • Additional indexes on x402_shielded_payments for agent-scoped and
--     status-ordered queries (dashboard + recovery poller)
--
-- All statements are idempotent — safe to re-run.

-- ── shielded_deposits: ensure chain-event columns exist ──────────────────────
ALTER TABLE shielded_deposits ADD COLUMN IF NOT EXISTS tx_hash       TEXT;
ALTER TABLE shielded_deposits ADD COLUMN IF NOT EXISTS confirmed_at  TIMESTAMPTZ;

-- ── x402_shielded_payments: agent and status indexes ─────────────────────────
-- Speeds up per-agent payment history lookups (agent dashboard / rate-limiting)
CREATE INDEX IF NOT EXISTS ix_x402_shielded_agent
  ON x402_shielded_payments (agent_id)
  WHERE agent_id IS NOT NULL;

-- Speeds up recovery-poller and status-filtered dashboard queries
CREATE INDEX IF NOT EXISTS ix_x402_shielded_status
  ON x402_shielded_payments (status, created_at DESC);

-- ── Down migration ────────────────────────────────────────────────────────────
-- DROP INDEX IF EXISTS ix_x402_shielded_status;
-- DROP INDEX IF EXISTS ix_x402_shielded_agent;
-- (tx_hash / confirmed_at columns intentionally left — removing them would
--  require a separate destructive migration)
