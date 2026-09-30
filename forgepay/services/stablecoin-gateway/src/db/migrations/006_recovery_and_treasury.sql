-- Recovery of stray tokens, dust return, and the treasury manager's ledger.

-- A deposit address can hold more than one kind of token (a payer sent the wrong one), so
-- "one sweep per deposit" becomes "one per deposit and token".
DROP INDEX IF EXISTS ux_deposit_sweeps_in_progress;
DROP INDEX IF EXISTS ux_deposit_sweeps_done;
CREATE UNIQUE INDEX IF NOT EXISTS ux_deposit_sweeps_in_progress_asset
  ON deposit_sweeps (deposit_id, asset) WHERE status IN ('planned','gas_sent','sending','failed');
CREATE UNIQUE INDEX IF NOT EXISTS ux_deposit_sweeps_done_asset
  ON deposit_sweeps (deposit_id, asset) WHERE status = 'swept';

ALTER TABLE deposit_sweeps
  ADD COLUMN IF NOT EXISTS kind     TEXT NOT NULL DEFAULT 'sweep' CHECK (kind IN ('sweep','recovery')),
  ADD COLUMN IF NOT EXISTS dust_wei TEXT,   -- native coin returned to the gas wallet after the sweep
  ADD COLUMN IF NOT EXISTS dust_tx  TEXT;

-- Movements of the gateway's own money between its wallets: topping up the payout wallet from
-- the operating treasury, and moving surplus from the treasury to cold storage.
-- Each row is written before anything is sent and gets its hash the moment it is, so a crash
-- can be reconciled against the chain.
CREATE TABLE IF NOT EXISTS treasury_transfers (
  id           UUID PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN ('replenish','replenish_gas','cold_sweep')),
  chain        TEXT NOT NULL,
  asset        TEXT NOT NULL,            -- a symbol, or NATIVE
  from_address TEXT NOT NULL,
  to_address   TEXT NOT NULL,
  units        TEXT NOT NULL,
  usd_micro    BIGINT NOT NULL DEFAULT 0, -- value in micro-dollars, for the daily cap
  status       TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','sent','confirmed','failed')),
  tx           TEXT,
  reason       TEXT,
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ix_treasury_transfers_recent ON treasury_transfers (created_at DESC);
CREATE INDEX IF NOT EXISTS ix_treasury_transfers_open ON treasury_transfers (asset, status) WHERE status IN ('planned','sent');

-- The manager's last view of things (shortfalls etc.), so an operator and the alerting can see it.
CREATE TABLE IF NOT EXISTS treasury_state (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
