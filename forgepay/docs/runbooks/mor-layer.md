# Runbook: MoR Layer (Merchant of Record) Incident Response

## Service: mor-layer (port 8010)

Handles checkout, tax calculation, customer management, and merchant
auth. Calls `payment-engine:8080` (Hyperswitch) for real payment
processing and forwards confirmed events to `unified-router:8000`.

### Symptom: All checkout requests failing / service won't start

**Cause:** `Settings.model_post_init()` gates required production secrets
(webhook secret, JWT secret, auditor config) on `environment ==
"production"` specifically — if `ENVIRONMENT` is set to anything else
unexpected (a typo, a new deploy-tooling default), startup either skips
required-secret validation it shouldn't, or — if some other code path
assumes any non-"development" value implies production-strength config —
fails to boot. Check `ENVIRONMENT` is exactly `"development"`,
`"staging"`, or `"production"`, not a variant.

**Resolution:**
1. `kubectl logs -n forgepay-prod -l app=mor-layer --tail=50` — a
   `RuntimeError`/config validation error at startup means the pod never
   became ready; check `ENVIRONMENT` and the required secrets
   (`MOR_WEBHOOK_SECRET`, `JWT_SECRET`, auditor keys) are actually present
   in the mounted secret.
2. If it's genuinely production but a secret is missing, the pod will
   crash-loop — this is intentional (fail closed rather than run
   unauthenticated in prod), not a bug to route around.

### Symptom: Checkout succeeds in tests but real payments always hit the wrong Hyperswitch endpoint

**Cause:** `get_hyperswitch_client()` used to be a bare singleton that
cached a client built from `get_settings()` on first call — if anything
overrides settings after the first request (blue/green config reload,
per-request tenant config), the cached client keeps using the *original*
base URL. This was fixed to rebuild when the configured base URL changes,
but if a future refactor reintroduces a bare singleton, this exact class
of bug returns.

**Resolution:**
1. Confirm `HYPERSWITCH_BASE_URL` (or equivalent) in the live pod's env
   matches what you expect — `kubectl exec` in and check, don't just trust
   the Helm values file (config precedence bugs hide here).
2. If checkout requests are landing on an unexpected host, restart the
   pod to clear any stale in-process client cache before deeper
   debugging.

### Symptom: Every rate-limited endpoint (checkout, merchants, alerts) returns 500 with `AttributeError`

**Cause:** This was a real, fleet-wide bug: `check_rate_limit()` called
`limiter.hit(limit_string)`, which is the Flask-Limiter API, not
slowapi's. If this regresses (e.g. a slowapi upgrade changes its
internal API again), every rate-limited request breaks immediately.

**Resolution:**
1. Check `src/rate_limiting.py` still uses the real `limits`-library
   contract (`limiter.limiter.hit(item, key, scope)`), not `.hit()`
   directly on the slowapi `Limiter`.
2. If slowapi was upgraded recently, check its changelog for internal API
   changes before assuming this is a new, different bug.

### Symptom: Webhook from payment-engine rejected / not forwarded to unified-router

**Cause:** HMAC signature mismatch (same failure mode as unified-router's
inbound webhooks — see that runbook) or the forward-to-unified-router
call failing silently.

**Resolution:**
1. Check `src/api/webhooks.py` logs for signature verification failures.
2. Confirm `MOR_WEBHOOK_SECRET` matches what payment-engine is configured
   to sign with.
3. Confirm `unified-router:8000/webhooks/hyperswitch` (or whichever
   forwarding path applies) is reachable from this pod's namespace — check
   the NetworkPolicy allows same-namespace egress (it should, by default).

### Symptom: Shielded/privacy checkout failing with 400 on proof or memo fields

**Cause:** This is largely expected in non-production environments —
`AuditorClient.verify_audit_proof()` and `decrypt_shielded_tx()` perform
real structural validation (proof byte-length checks) and real
X25519/AES-GCM decryption respectively; placeholder/test data that isn't
actually proof-shaped or isn't real ciphertext is *correctly* rejected,
not a bug. If this happens for genuine production shielded-checkout
traffic, escalate to the ZK/privacy integration owner — this is a
different, deeper issue than a normal checkout failure.
