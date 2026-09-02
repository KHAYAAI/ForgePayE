-- Add product licensing and subscription tracking to customers table
-- Migration: 001_add_customer_products.sql

ALTER TABLE customers ADD COLUMN IF NOT EXISTS products TEXT[] DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS subscriptions JSONB DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS kb_account_id VARCHAR(255);

-- Index for product queries (used by requireProduct() middleware)
CREATE INDEX IF NOT EXISTS idx_customer_products ON customers USING gin(products);

-- Track subscription lifecycle events
CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGSERIAL PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL,
  product VARCHAR(50) NOT NULL,
  event_type VARCHAR(50) NOT NULL,  -- 'CREATED' | 'UPGRADED' | 'DOWNGRADED' | 'CANCELLED' | 'TRIAL_STARTED' | 'TRIAL_ENDED'
  kb_subscription_id VARCHAR(255),
  plan_name VARCHAR(255),
  billing_amount NUMERIC(10, 2),
  previous_plan VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes are declared separately: an inline `INDEX name (cols)` clause inside
-- CREATE TABLE is MySQL syntax and is a hard parse error in Postgres, which
-- aborted this migration at the CREATE TABLE and meant subscription_events was
-- never created at all — the products columns above it applied, so the failure
-- looked partial rather than total.
CREATE INDEX IF NOT EXISTS idx_subevents_customer_product ON subscription_events (customer_id, product);
CREATE INDEX IF NOT EXISTS idx_subevents_type            ON subscription_events (event_type);
CREATE INDEX IF NOT EXISTS idx_subevents_kb_subscription ON subscription_events (kb_subscription_id);

-- Revenue ontology expanded: add subscription-related events
-- (existing revenue_events table already supports this via metadata JSONB)
