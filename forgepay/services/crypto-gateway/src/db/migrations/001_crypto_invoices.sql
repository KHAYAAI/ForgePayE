-- Migration 001: crypto_invoices table
-- Run once before starting the crypto-gateway service.

CREATE TABLE IF NOT EXISTS crypto_invoices (
  id                     UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id            TEXT          NOT NULL,
  coin                   TEXT          NOT NULL CHECK (coin IN ('BTC','ETH','LTC','XMR')),
  amount_crypto          NUMERIC(20,8) NOT NULL,
  amount_usd             NUMERIC(12,2),
  price_usd_at_creation  NUMERIC(12,2),
  address                TEXT          NOT NULL,
  key_index              INTEGER       NOT NULL,
  status                 TEXT          NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','confirming','confirmed','underpaid','expired','failed')),
  tx_id                  TEXT,
  confirmations          INTEGER       NOT NULL DEFAULT 0,
  required_confirmations INTEGER       NOT NULL DEFAULT 3,
  payment_id             TEXT,
  description            TEXT,
  expires_at             TIMESTAMPTZ   NOT NULL,
  created_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
  received_at            TIMESTAMPTZ,
  confirmed_at           TIMESTAMPTZ,
  metadata               JSONB
);

CREATE INDEX IF NOT EXISTS idx_crypto_invoices_merchant_status
  ON crypto_invoices (merchant_id, status);
CREATE INDEX IF NOT EXISTS idx_crypto_invoices_address
  ON crypto_invoices (address);
CREATE INDEX IF NOT EXISTS idx_crypto_invoices_expires_at
  ON crypto_invoices (expires_at) WHERE status = 'pending';
