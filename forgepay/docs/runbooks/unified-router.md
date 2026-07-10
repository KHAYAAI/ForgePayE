# Runbook: Unified Router Incident Response

## Service: unified-router (port 8000, metrics on the same port at /metrics)

Normalizes webhooks from payment-engine (Hyperswitch), billing-engine
(Kill Bill), stablecoin-gateway, crypto-gateway, forge-custody, and
forge-wallet into canonical `ForgePayEvent`s, persists them to
`forgepay_events`, and fans out to merchant-configured webhook endpoints.
This is the single event bus every downstream product reads from — an
outage here is silent data loss for every other service, not just a
degraded feature.

### Symptom: Inbound webhooks returning 401 `invalid_signature`

**Cause:** Wrong or rotated `*_WEBHOOK_SECRET` env var, or the sender is
signing a different payload than what's arriving (e.g. a proxy/gateway
in front of unified-router re-serializing the JSON body, which changes
byte-for-byte content and breaks HMAC verification even though the
"same" JSON is being sent).

**Resolution:**
1. Confirm which source is failing: check `logger.warn(... 'Invalid
   webhook signature')` log lines for the `source` field.
2. Verify the matching secret in `forgepay-unified-router-secrets` matches
   what the sending service has configured (`HYPERSWITCH_WEBHOOK_SECRET`,
   `KILLBILL_WEBHOOK_SECRET`, `STABLECOIN_GW_WEBHOOK_SECRET`,
   `CRYPTO_GW_WEBHOOK_SECRET`, `FORGE_CUSTODY_WEBHOOK_SECRET`,
   `FORGE_WALLET_WEBHOOK_SECRET`).
3. If secrets match: check whether anything between the sender and this
   service (ingress, service mesh sidecar, LB) is decompressing/re-
   encoding the body. Signature verification is over the *exact* raw
   bytes captured by the custom content-type parser in `index.ts` — any
   re-serialization anywhere in the path breaks it.
4. For `forge-custody`/`forge-wallet` specifically, also check the
   `x-forge-timestamp` header is present and within
   `TIMESTAMP_WINDOW_SECONDS` — a clock-skewed sender gets rejected with
   `invalid_timestamp`, not `invalid_signature`; don't misdiagnose one as
   the other.

### Symptom: Events not reaching merchants (webhook fan-out silently missing)

**Cause:** Either the event was deduplicated as a false positive, or
`dispatchToMerchants` failed asynchronously (it's fire-and-forget — the
webhook ACK to the *sender* happens before dispatch to merchants
completes, so a dispatch failure never surfaces as an HTTP error to
anyone upstream).

**Resolution:**
1. `SELECT * FROM forgepay_events WHERE source_event_id = '<id>'` — if
   the row exists, the event *was* received and persisted; the fan-out
   step is what failed.
2. Check logs for `'Merchant dispatch error'` around the event's
   timestamp — this only appears in logs, never surfaces to the sender.
3. Query `merchant_webhook_endpoints` for the merchant to confirm their
   endpoint URL is current and not returning non-2xx (dispatch likely
   retries; check `dispatch.ts` retry/backoff behavior for whether it's
   given up).
4. If the row does *not* exist at all: check Redis — `deduplicateEvent()`
   may have returned a false positive (stale entry from a previous,
   different event that happened to reuse a `sourceEventId`, or a bug in
   the upstream normalizer generating a non-unique ID). Check
   `fp:dedup:event:{sourceEventId}` in Redis directly.

### Symptom: Every webhook silently accepted as `processed: false` (never actually processed)

**Cause:** The relevant `normalize*Event()` function returned `null` —
usually an unrecognized `event_type`/`webhook_type` field, or (rarer) the
sender changed their payload schema and the field the normalizer keys
off no longer matches.

**Resolution:**
1. Response body is `{"received": true, "processed": false}` with no
   `reason` field — this specific combination means normalization
   returned null (distinct from `"reason": "duplicate"`).
2. Check the raw payload in the request logs for the actual event-type
   field value and compare against the normalizer's expected values
   (`src/normalizers/*.ts`) — if the sending service added a new event
   type, the normalizer needs a matching case, not just a config change.

### Symptom: Migrations not applied on a fresh deployment

**Cause:** `runMigrations()` runs at startup (before the app accepts
traffic) but requires `DATABASE_URL`/Postgres connectivity; if Postgres
isn't reachable at boot, the service throws in production (or logs a
warning and falls back in dev) rather than silently running with an
empty schema.

**Resolution:**
1. Check startup logs for `'[unified-router] Migrations failed'`.
2. Verify Postgres is reachable from the pod's namespace (see the
   `database.md` runbook for connectivity checks) before restarting —
   restarting without fixing connectivity just repeats the failure.

### Symptom: `/metrics` returning 404 or empty

**Cause:** This was a real gap fixed in this codebase's history — verify
the fix is actually deployed (`GET :8000/metrics` should return
Prometheus text-exposition format, not 404). If it 404s again after a
future refactor, check `src/routes/health.ts` still registers the
`/metrics` route and that nothing accidentally reintroduced a separate,
unbound "metrics port" in the Helm chart (Service/Deployment must expose
metrics on the same port the app actually listens on — this service has
no second listener).
