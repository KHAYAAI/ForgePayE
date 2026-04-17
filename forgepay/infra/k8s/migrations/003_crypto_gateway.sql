-- Migration 003: crypto-gateway tables
-- Invoice-based crypto payment records (BTC, ETH, LTC, XMR).

CREATE TABLE IF NOT EXISTS crypto_invoices (
  id                       UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id              UUID          NOT NULL,
  address                  TEXT          NOT NULL,
  coin                     TEXT          NOT NULL,   -- BTC | ETH | LTC | XMR
  amount_usd               NUMERIC(12,4) NOT NULL,
  amount_crypto            TEXT          NOT NULL,   -- string to preserve precision
  price_usd_at_creation    NUMERIC(16,4) NOT NULL,
  payment_id               TEXT,
  description              TEXT,
  metadata                 JSONB,
  status                   TEXT          NOT NULL DEFAULT 'pending',  -- pending|received|confirmed|expired|underpaid|overpaid
  received_amount_crypto   TEXT,
  tx_id                    TEXT,
  received_at              TIMESTAMPTZ,
  confirmed_at             TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ   NOT NULL,
  created_at               TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_crypto_invoices_address  ON crypto_invoices (address);
CREATE INDEX IF NOT EXISTS ix_crypto_invoices_merchant ON crypto_invoices (merchant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_crypto_invoices_status   ON crypto_invoices (status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ix_crypto_invoices_coin     ON crypto_invoices (coin);
