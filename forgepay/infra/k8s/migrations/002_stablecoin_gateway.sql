-- Migration 002: stablecoin-gateway tables
-- Deposit addresses and x402 micropayment records.

CREATE TABLE IF NOT EXISTS stablecoin_deposits (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id          UUID        NOT NULL,
  address              TEXT        NOT NULL,
  private_key_enc      TEXT        NOT NULL,   -- encrypted with KMS in production
  chain                TEXT        NOT NULL,   -- ethereum | polygon | base | arbitrum | solana
  token                TEXT        NOT NULL,   -- USDC | USDT
  amount_units         TEXT        NOT NULL,   -- expected amount in token units (6 decimals)
  amount_usd           NUMERIC(12,4) NOT NULL,
  payment_id           TEXT,                   -- optional link to forgepay payment record
  metadata             JSONB,
  status               TEXT        NOT NULL DEFAULT 'pending',  -- pending|confirming|confirmed|expired|overpaid
  received_amount_units TEXT,                  -- actual amount received (may differ from expected)
  tx_hash              TEXT,
  received_at          TIMESTAMPTZ,
  confirmed_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_stablecoin_deposits_address  ON stablecoin_deposits (LOWER(address));
CREATE INDEX IF NOT EXISTS ix_stablecoin_deposits_merchant ON stablecoin_deposits (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_stablecoin_deposits_status   ON stablecoin_deposits (status) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS x402_payments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id   UUID        REFERENCES stablecoin_deposits(id),
  merchant_id  UUID        NOT NULL,
  agent_id     TEXT,                           -- optional AI agent identifier
  resource_url TEXT        NOT NULL,
  amount_usdc  NUMERIC(12,4) NOT NULL,
  amount_units TEXT        NOT NULL,           -- USDC units on Base
  chain        TEXT        NOT NULL DEFAULT 'base',
  token        TEXT        NOT NULL DEFAULT 'USDC',
  status       TEXT        NOT NULL DEFAULT 'pending',  -- pending|confirmed|expired
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_x402_payments_merchant ON x402_payments (merchant_id, created_at DESC);
