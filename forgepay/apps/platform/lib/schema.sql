-- ForgePay Console — core auth schema
-- Idempotent: safe to run repeatedly (CREATE TABLE IF NOT EXISTS + additive ALTERs).
-- Run via: npm run db:migrate  (apps/platform/scripts/migrate.mjs)

CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- SSO (WorkOS-brokered OIDC/SAML). A tenant with no workos_organization_id
-- simply has no SSO option and logs in with password + optional TOTP as
-- before. sso_required, once set, blocks password login for every user on
-- the tenant (see lib/auth.ts's login route) — the enterprise's own IdP
-- becomes the only way in, which is what "enterprise SSO" actually means to
-- the security team asking for it, not just "SSO available as an option".
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS domain TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS workos_organization_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS sso_required BOOLEAN NOT NULL DEFAULT false;

-- Which products this tenant has actually turned on. Empty for every new
-- signup on purpose — the console must not show Custody, Wallet, Treasury
-- etc. as if they were in use before the tenant ever chose them. Console-
-- native preference, deliberately separate from unified-router's billing
-- entitlements (customers.products / entitlements table): this gates what
-- the *nav* shows, not what's paid for — Payments' own "activated" state
-- (has this tenant completed checkout) is tracked in unified-router and
-- checked independently once Payments is turned on here.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS enabled_products TEXT[] NOT NULL DEFAULT '{}';

-- The tenant's identity in open-privy (the real wallet-custody backend FORGE
-- Wallet is now backed by). NULL until first wallet access, when
-- lib/openprivy.ts provisions a row directly in open-privy's own `users`
-- table (its real signup flow requires Supabase, which we don't run) and
-- records the resulting id here. One open-privy user per FORGE tenant, not
-- per FORGE human user — wallets in the console are a tenant-level resource.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS openprivy_user_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_domain ON tenants(domain) WHERE domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  api_key       TEXT NOT NULL UNIQUE,
  role          TEXT NOT NULL DEFAULT 'analyst',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Additive migration for pre-existing deployments that lack the role column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'analyst';

-- MFA (TOTP). totp_secret is set on enrollment but totp_enabled stays false
-- until the user confirms one code — see lib/mfa.ts. backup_codes holds
-- sha256 hashes only, one-time use, cleared as they're consumed.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_backup_codes TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_email  ON users(email);

-- Sessions — every issued JWT carries a `jti` claim matching sessions.id.
-- getCurrentUser() checks this table on every request (not just the JWT
-- signature) so a session can be revoked before its 7-day expiry: "log out
-- everywhere", an admin force-logging-out a compromised account, MFA being
-- enabled/disabled, etc. See lib/auth.ts.
CREATE TABLE IF NOT EXISTS sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address    TEXT,
  user_agent    TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, revoked_at, expires_at);

-- Audit log — append-only. actor_email is denormalized (survives the actor
-- user row being deleted) so historical entries stay readable. A failed
-- login has no actor_user_id (the email wasn't necessarily real) but the
-- attempted email is still recorded in actor_email for anomaly detection.
CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  tenant_id      TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  actor_user_id  TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email    TEXT,
  action         TEXT NOT NULL,
  resource       TEXT,
  detail         JSONB,
  ip_address     TEXT,
  user_agent     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_log(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor        ON audit_log(actor_user_id, created_at DESC);

-- Teammate invitations. Only the sha256 of the token is stored, so a database
-- read can't be turned into a working invite link. An invitation is usable
-- while accepted_at, revoked_at are NULL and expires_at is in the future.
CREATE TABLE IF NOT EXISTS invitations (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'approver', 'analyst')),
  token_hash  TEXT NOT NULL UNIQUE,
  invited_by  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_invitations_tenant ON invitations(tenant_id);
-- At most one live invitation per address per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS idx_invitations_live
  ON invitations(tenant_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- Per-user API keys are stored as 'sha256:<hex>' of the key. Upgrade any still held in the clear (idempotent).
UPDATE users SET api_key = 'sha256:' || encode(sha256(convert_to(api_key, 'UTF8')), 'hex') WHERE api_key NOT LIKE 'sha256:%';

-- Consent an agent's operator has given for a lender to pull that agent's credit report. The token itself is a bearer
-- credential handed to the operator once and is never stored here; this table records who authorised what, so it can be
-- listed, audited and revoked. A workspace may revoke only its own rows.
CREATE TABLE IF NOT EXISTS bureau_consents (
  jti           TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id      TEXT NOT NULL,
  requestor_id  TEXT NOT NULL,
  purpose       TEXT NOT NULL,
  issued_by     TEXT NOT NULL,
  issued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_bureau_consents_tenant ON bureau_consents(tenant_id, issued_at DESC);

-- Linking a wallet the user controls to an agent, by a signed message (the user keeps the key; FORGE never sees it).
-- A challenge is single-use and short-lived; a binding records that control was proven, when, and for which workspace.
CREATE TABLE IF NOT EXISTS wallet_challenges (
  nonce       TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  message     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS wallet_bindings (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  address     TEXT NOT NULL,
  agent_id    TEXT NOT NULL,
  proved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  proved_by   TEXT NOT NULL,
  UNIQUE (tenant_id, address, agent_id)
);

