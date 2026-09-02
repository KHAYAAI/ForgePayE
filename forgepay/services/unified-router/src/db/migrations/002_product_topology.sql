-- ForgePay product topology — the schema behind "pick the platforms you want".
--
-- Idempotent: safe to run repeatedly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why this migration exists
--
-- The product-entitlement subsystem was written but never given a schema.
-- `require-product.ts`, `bundle.ts`, `customer.ts`, `upsell-engine.ts` and
-- `churn-prevention.ts` all query `customers` and `revenue_events`, and no
-- migration in this service creates either one. 001 assumed `customers`
-- already existed (its first statement is an ALTER) and its comment claims the
-- "existing revenue_events table" supports subscription events — but nothing
-- has ever created it. Every one of those call sites would fail at runtime
-- with "relation does not exist", which is survivable only because none of
-- them are mounted in index.ts yet.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- The model: star + mesh
--
-- Each product is an independent entry point (a star's head) that a customer
-- can buy on its own — payments without the bureau, the bureau without
-- treasury. Products are rows in `products`, not an enum, so a new platform is
-- onboarded with an INSERT rather than a migration and a redeploy.
--
-- The mesh is `revenue_events`: whatever a customer entered through, every
-- revenue-affecting act lands in one ontology, tagged with the product that
-- produced it. That is what makes "bureau pulls are cheaper if you also take
-- payments" answerable — cross-product pricing needs one place that knows
-- everything a customer does.

-- ── Customers ────────────────────────────────────────────────────────────────
-- Referenced by 001's ALTERs and by five modules; never created until now.
CREATE TABLE IF NOT EXISTS customers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  email        TEXT NOT NULL,
  name         TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_email ON customers (tenant_id, email);

-- Columns 001 adds. Repeated here so a fresh database converges to the same
-- shape regardless of which migration runs first.
ALTER TABLE customers ADD COLUMN IF NOT EXISTS products      TEXT[] DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS subscriptions JSONB  DEFAULT '{}';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS kb_account_id VARCHAR(255);

-- ── Product catalog ──────────────────────────────────────────────────────────
-- One row per platform a customer can select. Adding "insurance" or "lending"
-- later is an INSERT, not a schema change — which is the whole point of a
-- catalog table over a CHECK constraint or an enum type.
CREATE TABLE IF NOT EXISTS products (
  key            TEXT PRIMARY KEY,          -- 'payments', 'credit-bureau', …
  name           TEXT NOT NULL,
  tagline        TEXT,
  -- Whether a customer can select this at signup, or it is invite-only /
  -- coming-soon. Lets the selection screen show a roadmap without granting it.
  availability   TEXT NOT NULL DEFAULT 'available'
                 CHECK (availability IN ('available', 'waitlist', 'private', 'retired')),
  -- Products this one needs in order to function. Empty for a true standalone
  -- star; non-empty makes the mesh edge explicit and enforceable rather than
  -- tribal knowledge.
  requires       TEXT[] NOT NULL DEFAULT '{}',
  sort_order     INT NOT NULL DEFAULT 100,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Entitlements ─────────────────────────────────────────────────────────────
-- The authoritative answer to "may this customer use this product". One row
-- per customer × product.
--
-- `customers.products` (the GIN-indexed TEXT[] from 001) stays as a read cache
-- for the hot middleware path, but it is derived — this table decides, and the
-- trigger below keeps the array in step so the two can never disagree.
CREATE TABLE IF NOT EXISTS entitlements (
  id             BIGSERIAL PRIMARY KEY,
  customer_id    UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL,
  product_key    TEXT NOT NULL REFERENCES products(key),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  plan           TEXT,                       -- tier within the product
  trial_ends_at  TIMESTAMPTZ,
  activated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at   TIMESTAMPTZ,
  metadata       JSONB NOT NULL DEFAULT '{}',
  UNIQUE (customer_id, product_key)
);

CREATE INDEX IF NOT EXISTS idx_entitlements_customer ON entitlements (customer_id, status);
CREATE INDEX IF NOT EXISTS idx_entitlements_product  ON entitlements (product_key, status);

-- ── Revenue ontology ─────────────────────────────────────────────────────────
-- The mesh. Every revenue-affecting act across every product lands here in one
-- shape, so revenue can be read per product, per customer, or across both
-- without joining five services together.
--
-- `amount_usd_cents` is integer cents: money in floating point drifts, and this
-- table is the one place that must reconcile.
CREATE TABLE IF NOT EXISTS revenue_events (
  id                BIGSERIAL PRIMARY KEY,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  tenant_id         UUID,
  product           TEXT NOT NULL,           -- not FK'd: events outlive a retired product
  event_type        TEXT NOT NULL,           -- SUBSCRIPTION_STARTED, INQUIRY_CHARGED, LICENSING_DENIED, …
  amount_usd_cents  BIGINT NOT NULL DEFAULT 0,
  currency          TEXT NOT NULL DEFAULT 'USD',
  metadata          JSONB NOT NULL DEFAULT '{}',
  event_timestamp   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_revenue_customer_time ON revenue_events (customer_id, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_product_time  ON revenue_events (product, event_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_revenue_type          ON revenue_events (event_type, event_timestamp DESC);

-- ── Keep the read cache honest ───────────────────────────────────────────────
-- Without this, `customers.products` and `entitlements` are two sources of
-- truth for the same question and will drift the first time one is written
-- without the other.
CREATE OR REPLACE FUNCTION sync_customer_products() RETURNS TRIGGER AS $$
BEGIN
  UPDATE customers c
     SET products = COALESCE((
           SELECT array_agg(e.product_key ORDER BY e.product_key)
             FROM entitlements e
            WHERE e.customer_id = c.id
              AND e.status IN ('active', 'trialing')
         ), '{}'),
         updated_at = NOW()
   WHERE c.id = COALESCE(NEW.customer_id, OLD.customer_id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_customer_products ON entitlements;
CREATE TRIGGER trg_sync_customer_products
AFTER INSERT OR UPDATE OR DELETE ON entitlements
FOR EACH ROW EXECUTE FUNCTION sync_customer_products();

-- ── Seed the catalog ─────────────────────────────────────────────────────────
-- Availability reflects what can honestly be sold today, not what exists in
-- the repository. Payments is 'private' because it is gated on an FSCA licence
-- that has not been granted; treasury and wallet are 'waitlist' because their
-- services still lose state on restart. Only the bureau is fully available.
INSERT INTO products (key, name, tagline, availability, requires, sort_order) VALUES
  ('credit-bureau', 'Credit Bureau', 'Credit files and underwriting reports for autonomous agents', 'available', '{}', 10),
  ('payments',      'Payments',      'One API for cards, bank transfers, stablecoins and crypto',    'private',   '{}', 20),
  ('treasury',      'Treasury',      'Corporate treasury, yield and liquidity management',            'waitlist',  '{}', 30),
  ('wallet',        'Wallet',        'Programmable wallets for agents and operators',                  'waitlist',  '{custody}', 40),
  ('custody',       'Custody',       'MPC key custody, sellable standalone or underneath any wallet', 'waitlist',  '{}', 45),
  ('compliance',    'Compliance',    'AML monitoring, sanctions screening and regulatory reporting',  'waitlist',  '{}', 50)
ON CONFLICT (key) DO UPDATE
  SET name = EXCLUDED.name,
      tagline = EXCLUDED.tagline,
      sort_order = EXCLUDED.sort_order;
