-- Customer API keys — the credential the licensing routes authenticate against.
--
-- Idempotent: safe to run repeatedly.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why this exists
--
-- bundle.ts, csm.ts, customer.ts and require-product.ts all read
-- `request.user.customerId` / `.tenantId`, and nothing has ever populated
-- `request.user`. The service had no notion of who is calling, so all four
-- modules sat unmounted in index.ts — 954 lines of licensing logic unreachable
-- because there was no way to answer "which customer is this".
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Why an API key rather than a session JWT
--
-- Every caller of this service is another service — chain-sync,
-- stablecoin-gateway and forge-wallet all reach it over UNIFIED_ROUTER_URL.
-- None of them carries a browser session, so verifying a user JWT would mean
-- inventing an issuer and coupling this service to whichever app minted the
-- token. A hashed bearer key is what machine-to-machine callers already use
-- elsewhere in this platform (see agent-credit-bureau/src/auth.ts, whose
-- conventions this mirrors deliberately).
--
-- Keys are stored only as sha256 digests. The raw value is shown once at issue
-- time and is not recoverable — the same rule the bureau applies to furnisher
-- keys after it was found returning them in plaintext.

ALTER TABLE customers ADD COLUMN IF NOT EXISTS api_key_hash TEXT;

-- Partial unique index: many customers may have no key yet (NULL), but a hash,
-- once set, identifies exactly one customer. A plain UNIQUE would forbid the
-- second NULL in some engines; the WHERE clause keeps un-keyed customers legal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_api_key_hash
  ON customers (api_key_hash)
  WHERE api_key_hash IS NOT NULL;

-- Lookup is by hash on every authenticated request, so it must be indexed —
-- covered by the unique index above.

COMMENT ON COLUMN customers.api_key_hash IS
  'sha256 of the customer''s bearer API key. Raw key is never stored. NULL means the customer has not been issued a key and cannot call authenticated routes.';
