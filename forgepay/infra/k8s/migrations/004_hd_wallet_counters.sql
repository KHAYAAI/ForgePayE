-- Migration 004: HD wallet derivation index tracking for crypto-gateway
-- Each coin gets one row; the counter is atomically incremented per invoice.
-- This ensures each invoice gets a unique BIP32 child key and no two invoices
-- ever share the same deposit address.

CREATE TABLE IF NOT EXISTS crypto_hd_counters (
  coin       TEXT    PRIMARY KEY,  -- 'BTC' | 'ETH' | 'LTC' | 'XMR'
  next_index INTEGER NOT NULL DEFAULT 0
);

-- Seed one row per supported coin so the UPDATE...RETURNING pattern works.
INSERT INTO crypto_hd_counters (coin, next_index) VALUES
  ('BTC', 0),
  ('ETH', 0),
  ('LTC', 0),
  ('XMR', 0)
ON CONFLICT (coin) DO NOTHING;

-- Add key_index column to existing invoices table.
-- Nullable so existing dev rows are unaffected; all new invoices populate it.
ALTER TABLE crypto_invoices ADD COLUMN IF NOT EXISTS key_index INTEGER;

CREATE INDEX IF NOT EXISTS ix_crypto_invoices_key_index ON crypto_invoices (coin, key_index);
