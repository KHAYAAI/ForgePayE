-- Sweeping deposits into the treasury.
--
-- A deposit's one-time address holds whatever was paid to it. A sweep moves that to the
-- treasury, after first giving the address just enough native coin to pay for the move.
-- One row per attempt, walked through a state machine that records each transaction hash
-- at the moment it is sent, so a crash can always be reconciled against the chain:
--
--   planned -> gas_sent -> sending -> swept
--                      \-> failed   (a person looks, then retries)
--                      \-> skipped  (nothing to move)
--
-- At most one sweep per deposit is in progress, and at most one ever completes.

CREATE TABLE IF NOT EXISTS deposit_sweeps (
  id               UUID PRIMARY KEY,
  deposit_id       UUID NOT NULL REFERENCES stablecoin_deposits(id),
  chain            TEXT NOT NULL,
  asset            TEXT NOT NULL,
  from_address     TEXT NOT NULL,
  treasury_address TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'planned'
                   CHECK (status IN ('planned','gas_sent','sending','swept','failed','skipped')),
  units            TEXT,                 -- what was actually moved (the balance at send time)
  gas_wei          TEXT,                 -- native coin sent to the deposit address to pay for the sweep
  gas_tx           TEXT,
  sweep_tx         TEXT,
  reason           TEXT,                 -- set when an operator forced a sweep of an unclaimed deposit
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_deposit_sweeps_in_progress
  ON deposit_sweeps (deposit_id) WHERE status IN ('planned','gas_sent','sending','failed');
CREATE UNIQUE INDEX IF NOT EXISTS ux_deposit_sweeps_done
  ON deposit_sweeps (deposit_id) WHERE status = 'swept';
CREATE INDEX IF NOT EXISTS ix_deposit_sweeps_status ON deposit_sweeps (status, created_at);

ALTER TABLE stablecoin_deposits ADD COLUMN IF NOT EXISTS swept_at TIMESTAMPTZ;
