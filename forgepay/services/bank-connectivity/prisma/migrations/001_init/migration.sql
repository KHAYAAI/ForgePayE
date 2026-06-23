-- ForgePay Bank Connectivity — Initial Schema
-- Creates: LinkedAccount, Transfer, InternalTransfer

CREATE TABLE IF NOT EXISTS "LinkedAccount" (
  "id"             TEXT         NOT NULL,
  "merchantId"     TEXT         NOT NULL,
  "provider"       TEXT         NOT NULL,
  "accountId"      TEXT         NOT NULL,
  "bankName"       TEXT         NOT NULL,
  "accountName"    TEXT         NOT NULL,
  "accountType"    TEXT         NOT NULL,
  "currency"       TEXT         NOT NULL DEFAULT 'USD',
  "encryptedToken" TEXT         NOT NULL,
  "balanceAvail"   DOUBLE PRECISION NOT NULL DEFAULT 0,
  "balanceCurrent" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "lastRefreshed"  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "disconnected"   BOOLEAN      NOT NULL DEFAULT FALSE,
  "createdAt"      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ  NOT NULL,

  CONSTRAINT "LinkedAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "LinkedAccount_merchantId_idx"
  ON "LinkedAccount" ("merchantId");

CREATE INDEX IF NOT EXISTS "LinkedAccount_merchantId_disconnected_idx"
  ON "LinkedAccount" ("merchantId", "disconnected");

-- ── Transfer ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Transfer" (
  "id"               TEXT         NOT NULL,
  "merchantId"       TEXT         NOT NULL,
  "accountId"        TEXT         NOT NULL,
  "type"             TEXT         NOT NULL,
  "direction"        TEXT         NOT NULL,
  "amountCents"      BIGINT       NOT NULL,
  "currency"         TEXT         NOT NULL DEFAULT 'USD',
  "recipientName"    TEXT,
  "recipientIban"    TEXT,
  "recipientRouting" TEXT,
  "reference"        TEXT,
  "description"      TEXT,
  "status"           TEXT         NOT NULL DEFAULT 'pending',
  "idempotencyKey"   TEXT,
  "externalRef"      TEXT,
  "failureReason"    TEXT,
  "createdAt"        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  "updatedAt"        TIMESTAMPTZ  NOT NULL,

  CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Transfer_idempotencyKey_key" UNIQUE ("idempotencyKey"),
  CONSTRAINT "Transfer_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "LinkedAccount" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "Transfer_merchantId_idx"
  ON "Transfer" ("merchantId");

CREATE INDEX IF NOT EXISTS "Transfer_status_idx"
  ON "Transfer" ("status");

CREATE INDEX IF NOT EXISTS "Transfer_idempotencyKey_idx"
  ON "Transfer" ("idempotencyKey");

-- ── InternalTransfer ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "InternalTransfer" (
  "id"          TEXT        NOT NULL,
  "source"      TEXT        NOT NULL,
  "fromAccount" TEXT        NOT NULL,
  "toAccount"   TEXT        NOT NULL,
  "amountCents" BIGINT      NOT NULL,
  "currency"    TEXT        NOT NULL DEFAULT 'USD',
  "reference"   TEXT,
  "description" TEXT,
  "status"      TEXT        NOT NULL DEFAULT 'pending',
  "externalRef" TEXT,
  "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMPTZ NOT NULL,

  CONSTRAINT "InternalTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "InternalTransfer_source_idx"
  ON "InternalTransfer" ("source");

CREATE INDEX IF NOT EXISTS "InternalTransfer_status_idx"
  ON "InternalTransfer" ("status");
