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
