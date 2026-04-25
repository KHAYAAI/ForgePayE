-- Migration 001: unified-router initial schema
-- Creates the canonical event log, merchant webhook endpoint registry,
-- and delivery log used by the webhook fan-out dispatcher.

-- ── Canonical event log ──────────────────────────────────────────────────────
-- One row per normalised payment event received from any source service.
-- source_event_id is the vendor-supplied idempotency key (e.g. Hyperswitch
-- payment_id, Kill Bill invoice UUID, etc.).  ON CONFLICT (source_event_id)
-- DO NOTHING in the INSERT provides a second idempotency guard after Redis.

CREATE TABLE IF NOT EXISTS forgepay_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  type             TEXT        NOT NULL,       -- e.g. payment.succeeded, invoice.paid
  source           TEXT        NOT NULL,       -- service name: payment-engine, billing-engine, …
  merchant_id      TEXT        NOT NULL,
  occurred_at      TIMESTAMPTZ NOT NULL,       -- when the event occurred in the source system
  processed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  data             JSONB       NOT NULL,       -- normalised canonical payload
  raw_payload      JSONB,                      -- original vendor payload (for debugging)
  source_event_id  TEXT        NOT NULL UNIQUE, -- vendor idempotency key
  api_version      TEXT                        -- vendor API version string, if present
);

CREATE INDEX IF NOT EXISTS idx_forgepay_events_merchant_occurred
  ON forgepay_events (merchant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_forgepay_events_type
  ON forgepay_events (type);
CREATE INDEX IF NOT EXISTS idx_forgepay_events_source
  ON forgepay_events (source);

-- ── Merchant webhook endpoint registry ──────────────────────────────────────
-- Stores the HTTPS URLs to which ForgePay fans out canonical events, one row
-- per registered endpoint.  signing_secret is used to HMAC-sign each delivery.

CREATE TABLE IF NOT EXISTS merchant_webhook_endpoints (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id     TEXT        NOT NULL,
  endpoint_url    TEXT        NOT NULL,
  signing_secret  TEXT        NOT NULL,        -- random hex secret, returned once on creation
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_webhook_endpoints_merchant
  ON merchant_webhook_endpoints (merchant_id) WHERE enabled = true;

-- ── Webhook delivery log ─────────────────────────────────────────────────────
-- One row per delivery attempt.  Used by the dashboard to show per-event
-- delivery history and to surface failed endpoints.

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      UUID        NOT NULL REFERENCES forgepay_events(id) ON DELETE CASCADE,
  endpoint_id   UUID        NOT NULL REFERENCES merchant_webhook_endpoints(id) ON DELETE CASCADE,
  attempt       INTEGER     NOT NULL,          -- 1-based attempt number
  status_code   INTEGER     NOT NULL DEFAULT 0,
  succeeded     BOOLEAN     NOT NULL DEFAULT false,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration_ms   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_event
  ON webhook_delivery_log (event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_endpoint
  ON webhook_delivery_log (endpoint_id, attempted_at DESC);
