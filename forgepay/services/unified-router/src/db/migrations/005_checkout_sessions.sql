-- Checkout sessions — the state a self-serve signup passes through between
-- "customer picked a plan" and "we've confirmed money moved (or didn't)".
--
-- Idempotent: safe to run repeatedly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why this needs its own table, not just a customers row
--
-- A customer row (002_product_topology.sql) represents a *provisioned*
-- account — it shouldn't exist until payment is confirmed, or a Free-tier
-- customer and a Standard-tier customer whose card was declined would be
-- indistinguishable in the customers table. This table is the staging area:
-- created when checkout starts, updated once (and only once — see the unique
-- partial index below) when payment is confirmed, and it's what
-- routes/checkout.ts's confirm step reads to decide whether the customer row
-- gets created at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why status transitions are constrained, not just any string
--
-- 'pending' -> 'succeeded' | 'declined' | 'stalled' | 'expired', and that's
-- the whole state machine. A CHECK constraint here is cheap insurance against
-- a future code change accidentally leaving a session in some fifth ad-hoc
-- status that nothing downstream knows how to handle.

CREATE TABLE IF NOT EXISTS checkout_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL DEFAULT gen_random_uuid(), -- one per prospect until they're a real customer
  email             TEXT NOT NULL,
  business_name     TEXT,
  tier_id           TEXT NOT NULL,               -- 'free' | 'standard' — validated against pricing.yaml, not trusted from the client
  monthly_fee_cents INTEGER NOT NULL,             -- snapshot of the price actually charged, in case pricing.yaml changes later
  payment_method    TEXT,                         -- 'card' | 'usdc' | NULL (free tier, no payment needed)
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'succeeded', 'declined', 'stalled', 'expired')),

  -- Card path
  hyperswitch_payment_id TEXT,
  -- USDC path
  x402_receipt_id        TEXT,

  -- Set once, on confirmation — the customer this session provisioned.
  customer_id       UUID REFERENCES customers(id),

  failure_reason    TEXT,                         -- human-readable, safe to show the customer
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at        TIMESTAMPTZ NOT NULL           -- checkout.ts sets this to created_at + sessionTtlMinutes
);

CREATE INDEX IF NOT EXISTS idx_checkout_sessions_status  ON checkout_sessions (status);
CREATE INDEX IF NOT EXISTS idx_checkout_sessions_expires ON checkout_sessions (expires_at) WHERE status = 'pending';

-- A session can be confirmed at most once. Without this, a retried confirm
-- call racing itself (client timeout + retry, a double-click) could create
-- two customer rows or double-charge — the same "one settle per period" class
-- of bug this platform has already fixed once, for furnisher payouts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_sessions_customer_once
  ON checkout_sessions (customer_id) WHERE customer_id IS NOT NULL;
