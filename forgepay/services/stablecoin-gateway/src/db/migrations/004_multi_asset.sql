-- Multi-asset settlement: USDC, USDT, ZARP (rand) and OUSD.
--
-- Idempotent. Also creates the deposit / x402 tables if the infra migration that
-- normally makes them hasn't run, so this service can stand on its own.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Two things in the original x402 schema meant a payment could never complete:
--
--   * merchant_id was UUID, but merchants are named by strings (the credit
--     bureau is 'forgepay-credit-bureau'), so the insert was rejected outright;
--   * x402_payments.deposit_id references stablecoin_deposits(id), but the pay
--     route invented a random id with no deposit behind it — no address for the
--     payer to send to, and nothing for the monitor to watch.
--
-- Payments now open a real deposit (its own one-time address) and link to it.

CREATE TABLE IF NOT EXISTS stablecoin_deposits (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id           TEXT        NOT NULL,
  address               TEXT        NOT NULL,
  private_key_enc       TEXT        NOT NULL,
  chain                 TEXT        NOT NULL,
  token                 TEXT        NOT NULL,
  amount_units          TEXT        NOT NULL,
  amount_usd            NUMERIC(20,6) NOT NULL,
  payment_id            TEXT,
  metadata              JSONB,
  status                TEXT        NOT NULL DEFAULT 'pending',
  received_amount_units TEXT,
  tx_hash               TEXT,
  received_at           TIMESTAMPTZ,
  confirmed_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS x402_payments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id   UUID        REFERENCES stablecoin_deposits(id),
  merchant_id  TEXT        NOT NULL,
  agent_id     TEXT,
  resource_url TEXT        NOT NULL,
  amount_usdc  NUMERIC(12,4) NOT NULL,
  amount_units TEXT        NOT NULL,
  chain        TEXT        NOT NULL DEFAULT 'base',
  token        TEXT        NOT NULL DEFAULT 'USDC',
  status       TEXT        NOT NULL DEFAULT 'pending',
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE stablecoin_deposits ALTER COLUMN merchant_id TYPE TEXT USING merchant_id::text;
ALTER TABLE stablecoin_deposits ALTER COLUMN amount_usd  TYPE NUMERIC(20,6);
ALTER TABLE x402_payments       ALTER COLUMN merchant_id TYPE TEXT USING merchant_id::text;

-- Deposits: which decimals the amount was quoted in, and where on-chain to start
-- looking for the payment (the block when the address was opened).
ALTER TABLE stablecoin_deposits
  ADD COLUMN IF NOT EXISTS decimals   INTEGER,
  ADD COLUMN IF NOT EXISTS from_block BIGINT,
  ADD COLUMN IF NOT EXISTS late_units TEXT,      -- units that arrived after expiry (never credited; for reconciliation)
  -- Settlement scans the chain forward and only ever adds *final* blocks (deeper than the
  -- confirmation threshold) to scan_units, so a reorg can't un-credit anything. scan_cursor
  -- is the last block whose transfers are already in scan_units.
  ADD COLUMN IF NOT EXISTS scan_cursor BIGINT,
  ADD COLUMN IF NOT EXISTS scan_units  TEXT NOT NULL DEFAULT '0';

-- x402: the asset paid in, what it is worth in dollars (the bureau's ledger unit),
-- the rate that was locked when the quote was given, and how it settled.
-- `amount_usdc` is kept for older readers and now means "USD value".
ALTER TABLE x402_payments
  ADD COLUMN IF NOT EXISTS asset          TEXT NOT NULL DEFAULT 'USDC',
  ADD COLUMN IF NOT EXISTS amount_usd     NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS decimals       INTEGER,
  ADD COLUMN IF NOT EXISTS fx_rate        NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_pair        TEXT,
  ADD COLUMN IF NOT EXISTS fx_as_of       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pay_to         TEXT,
  ADD COLUMN IF NOT EXISTS received_units TEXT,
  ADD COLUMN IF NOT EXISTS tx_hash        TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at   TIMESTAMPTZ;
UPDATE x402_payments SET amount_usd = amount_usdc WHERE amount_usd IS NULL;

CREATE INDEX IF NOT EXISTS ix_stablecoin_deposits_address_lc ON stablecoin_deposits (LOWER(address));
CREATE INDEX IF NOT EXISTS ix_stablecoin_deposits_open ON stablecoin_deposits (chain, status) WHERE status IN ('pending', 'confirming');
CREATE INDEX IF NOT EXISTS ix_x402_payments_deposit ON x402_payments (deposit_id);

-- Outbound payouts: the asset, the exact units that will be sent, and the rate
-- they were computed at. Fixed when the payout is created, so a retried request
-- (same external_id) always refers to the same amount, whatever the rate did since.
-- `amount_usdc` is kept and means "USD value"; the ceilings and approval
-- threshold are in USD whatever asset is paid.
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS asset        TEXT NOT NULL DEFAULT 'USDC',
  ADD COLUMN IF NOT EXISTS amount_usd   NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS amount_units TEXT,
  ADD COLUMN IF NOT EXISTS decimals     INTEGER,
  ADD COLUMN IF NOT EXISTS fx_rate      NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS fx_pair      TEXT;
UPDATE payouts SET amount_usd = amount_usdc WHERE amount_usd IS NULL;
UPDATE payouts SET decimals = 6, amount_units = ROUND(amount_usdc * 1000000)::bigint::text WHERE amount_units IS NULL;

-- Operator-set exchange rates, with who set them and when, so a stale rate can be refused.
CREATE TABLE IF NOT EXISTS fx_rates (
  id         BIGSERIAL PRIMARY KEY,
  pair       TEXT          NOT NULL,                 -- e.g. 'USD/ZAR'
  rate       NUMERIC(20,8) NOT NULL CHECK (rate > 0), -- quote units per one base unit
  as_of      TIMESTAMPTZ   NOT NULL,
  source     TEXT          NOT NULL,
  set_by     TEXT          NOT NULL,
  created_at TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_fx_rates_pair ON fx_rates (pair, as_of DESC, id DESC);
