-- ForgePay Events Table
-- Canonical event store — all payment events from all services land here.
-- Append-only by design. Never UPDATE or DELETE rows.

CREATE TABLE IF NOT EXISTS forgepay_events (
  id               UUID         NOT NULL,
  type             VARCHAR(64)  NOT NULL,
  source           VARCHAR(32)  NOT NULL,
  merchant_id      VARCHAR(64)  NOT NULL,
  occurred_at      TIMESTAMPTZ  NOT NULL,
  processed_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  data             JSONB        NOT NULL DEFAULT '{}',
  raw_payload      JSONB        NOT NULL DEFAULT '{}',
  source_event_id  VARCHAR(256) NOT NULL,
  api_version      VARCHAR(16)  NOT NULL DEFAULT '2026-04',

  CONSTRAINT forgepay_events_pkey PRIMARY KEY (id),
  -- Dedup: one row per source event, ever
  CONSTRAINT forgepay_events_source_event_id_unique UNIQUE (source_event_id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_events_merchant_occurred
  ON forgepay_events (merchant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_type
  ON forgepay_events (type);

CREATE INDEX IF NOT EXISTS idx_events_source
  ON forgepay_events (source);

-- Partial index for payment succeeded events (used for revenue reporting)
CREATE INDEX IF NOT EXISTS idx_events_payment_succeeded
  ON forgepay_events (merchant_id, occurred_at DESC)
  WHERE type = 'payment.succeeded';

COMMENT ON TABLE forgepay_events IS
  'Immutable canonical event log. All payment sub-services write here via unified-router.';

-- Merchant webhook endpoints
CREATE TABLE IF NOT EXISTS merchant_webhook_endpoints (
  id            UUID         NOT NULL DEFAULT gen_random_uuid(),
  merchant_id   VARCHAR(64)  NOT NULL,
  endpoint_url  TEXT         NOT NULL,
  signing_secret VARCHAR(256) NOT NULL,
  enabled       BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

  CONSTRAINT merchant_webhook_endpoints_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_merchant
  ON merchant_webhook_endpoints (merchant_id)
  WHERE enabled = true;

-- Webhook delivery log
CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id            UUID         NOT NULL DEFAULT gen_random_uuid(),
  event_id      UUID         NOT NULL REFERENCES forgepay_events(id),
  endpoint_id   UUID         NOT NULL REFERENCES merchant_webhook_endpoints(id),
  attempt       SMALLINT     NOT NULL DEFAULT 1,
  status_code   SMALLINT,
  succeeded     BOOLEAN      NOT NULL DEFAULT false,
  attempted_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  duration_ms   INTEGER,

  CONSTRAINT webhook_delivery_log_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_delivery_log_event
  ON webhook_delivery_log (event_id);
