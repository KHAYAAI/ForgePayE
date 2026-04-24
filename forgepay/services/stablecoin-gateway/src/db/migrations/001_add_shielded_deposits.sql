-- Migration: Add shielded deposit tables for Phase 5 (Privacy-Preserving Stablecoin Gateway)
--
-- Privacy design:
--   shielded_deposits intentionally has NO amount_usd / amount_units column.
--   The merchant MUST NOT be able to see plaintext amounts from their DB.
--   Amount is hidden inside encrypted_memo, decryptable only by the auditor.
--
--   x402_shielded_payments similarly stores no plaintext amount — only a nullifier
--   and encrypted memo. Resource servers learn only "valid: true/false", not amounts.

-- ── Shielded USDC/USDT deposits ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shielded_deposits (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT         NOT NULL,
  nullifier       TEXT         NOT NULL UNIQUE,  -- ZK nullifier; prevents double-spend
  encrypted_memo  TEXT         NOT NULL,          -- base64 ECDH+AES-GCM (auditor-only decryptable)
  proof_bytes     TEXT         NOT NULL,          -- base64 Groth16 deposit proof
  chain           TEXT         NOT NULL CHECK (chain IN ('ethereum', 'polygon', 'base', 'arbitrum')),
  token           TEXT         NOT NULL CHECK (token IN ('USDC', 'USDT')),
  status          TEXT         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'confirming', 'confirmed', 'failed', 'frozen')),
  tx_hash         TEXT,                           -- on-chain tx when nullifier spent
  expires_at      TIMESTAMPTZ  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  frozen_reason   TEXT,                           -- set by auditor compliance action
  metadata        JSONB
);

-- Fast lookup by merchant + status (dashboard queries)
CREATE INDEX IF NOT EXISTS ix_shielded_deposits_merchant_status
  ON shielded_deposits (merchant_id, status);

-- Fast lookup by nullifier (double-spend prevention + event matching)
CREATE INDEX IF NOT EXISTS ix_shielded_deposits_nullifier
  ON shielded_deposits (nullifier);

-- ── Shielded x402 payments (AI agent privacy) ────────────────────────────────
CREATE TABLE IF NOT EXISTS x402_shielded_payments (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT         NOT NULL,
  agent_id        TEXT,                           -- optional: paying AI agent identifier
  resource_url    TEXT         NOT NULL,
  nullifier       TEXT         NOT NULL UNIQUE,  -- ZK nullifier; prevents double-spend
  encrypted_memo  TEXT         NOT NULL,          -- base64 ECDH+AES-GCM
  proof_bytes     TEXT         NOT NULL,          -- base64 Groth16 proof
  chain           TEXT         NOT NULL DEFAULT 'base',
  token           TEXT         NOT NULL DEFAULT 'USDC',
  status          TEXT         NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'confirming', 'confirmed', 'failed', 'frozen')),
  tx_hash         TEXT,
  expires_at      TIMESTAMPTZ  NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  confirmed_at    TIMESTAMPTZ,
  frozen_reason   TEXT
);

CREATE INDEX IF NOT EXISTS ix_x402_shielded_nullifier
  ON x402_shielded_payments (nullifier);

CREATE INDEX IF NOT EXISTS ix_x402_shielded_merchant_status
  ON x402_shielded_payments (merchant_id, status);

-- ── Down migration ────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS x402_shielded_payments;
-- DROP TABLE IF EXISTS shielded_deposits;
