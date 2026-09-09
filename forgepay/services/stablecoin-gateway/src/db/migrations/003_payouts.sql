-- Outbound USDC payouts.
--
-- Idempotent: safe to run repeatedly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why this table exists
--
-- This gateway has only ever received money. The credit bureau owes its data
-- furnishers 25% of every paid inquiry, computes the attribution, and had no
-- rail to pay it over — the amount owed was known and unpayable. Paying a
-- furnisher is the x402 top-up flow run in reverse, and this is its ledger.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- The unique index is the idempotency guarantee
--
-- (requested_by, external_id) is UNIQUE, and createPayout() inserts with
-- ON CONFLICT DO NOTHING rather than checking for an existing row first. That
-- distinction matters for outbound money specifically: a check-then-insert
-- races against a retry of the same payout — a client timeout, a restarted
-- worker — and the loser of that race sends a second time. Deduplication has to
-- be a property of the schema, not of the handler remembering to look.
--
-- Scoped to the requester rather than global, so two different services can
-- both use their own natural key ("inquiry_2026_09_aave") without colliding.

CREATE TABLE IF NOT EXISTS payouts (
  id              UUID PRIMARY KEY,
  external_id     TEXT        NOT NULL,
  payee_id        TEXT        NOT NULL,
  payee_address   TEXT        NOT NULL,
  chain           TEXT        NOT NULL DEFAULT 'base',
  amount_usdc     NUMERIC(20, 6) NOT NULL CHECK (amount_usdc > 0),

  -- pending_approval → approved → submitted → confirmed
  --                 ↘ rejected            ↘ failed
  status          TEXT        NOT NULL DEFAULT 'pending_approval'
                  CHECK (status IN ('pending_approval','approved','submitted','confirmed','failed','rejected')),

  reason          TEXT        NOT NULL,
  requested_by    TEXT        NOT NULL,
  approved_by     TEXT,
  approved_at     TIMESTAMPTZ,
  tx_hash         TEXT,
  failure_reason  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The idempotency key. Without this, a retried payout request is a second
-- transfer rather than a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_requester_external
  ON payouts (requested_by, external_id);

-- Operational reads: "what does this furnisher have outstanding", and
-- "what is waiting for an approver".
CREATE INDEX IF NOT EXISTS idx_payouts_payee   ON payouts (payee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payouts_status  ON payouts (status, created_at DESC);

-- A transaction hash, once written, identifies exactly one payout. A duplicate
-- would mean two ledger rows claiming the same on-chain transfer, which is the
-- signature of a double-send that the application layer failed to prevent.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payouts_tx_hash
  ON payouts (tx_hash) WHERE tx_hash IS NOT NULL;

COMMENT ON TABLE payouts IS
  'Outbound USDC transfers. Idempotent on (requested_by, external_id); approval-gated above PAYOUT_AUTO_APPROVE_MAX_USD.';
