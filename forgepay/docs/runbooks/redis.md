# Runbook: Redis Incident Response

## Shared Redis (`forgepay-redis-master`, default port 6379)

Used for webhook event deduplication (unified-router,
`fp:dedup:event:{sourceEventId}`, 7-day TTL), rate limiting (slowapi in
the Python services), and various in-process cache TTLs.

### Symptom: unified-router processing the same webhook event multiple times

**Cause:** Redis dedup keys evicted early under memory pressure (LRU),
or Redis was restarted/flushed, losing all dedup state. This is an
**expected, tolerated failure mode** — the Postgres unique index on
`source_event_id` is the hard second guard specifically for this case
(see the `unified-router.md` runbook). If duplicate *processing* is
happening but duplicate *merchant dispatch* is not, this is working as
designed.

**Resolution:**
1. Confirm merchants are not receiving duplicate webhook notifications —
   if they are, check that `persistEvent()`'s insert-result is actually
   being checked before dispatch (a real bug that existed and was fixed
   in this codebase's history — verify the fix is deployed, don't assume).
2. If Redis was flushed/restarted, this is expected to self-heal — new
   events populate fresh dedup keys going forward; no action needed
   beyond monitoring merchant-dispatch counts return to normal.

### Symptom: Every rate-limited endpoint in a Python service returns 500

**Cause:** This class of bug already happened once — slowapi's
`Limiter` doesn't have the `.hit(limit_string)` method some code assumed
(that's the Flask-Limiter API). If this recurs after a slowapi/limits
library upgrade, check `rate_limiting.py` in the affected service against
the real `limits`-library contract before assuming it's a Redis
connectivity issue — the error surfaces as an `AttributeError`, not a
connection error, so don't waste time checking Redis health first.

**Resolution:**
1. Check the actual exception — `AttributeError: 'Limiter' object has no
   attribute 'hit'` means it's a code bug, not a Redis outage.
2. `redis-cli -h forgepay-redis-master PING` to separately confirm Redis
   itself is healthy (rule this out quickly so you don't chase the wrong
   cause).

### Symptom: Redis memory usage climbing steadily

**Cause:** Dedup keys have a 7-day TTL and should expire automatically —
sustained growth past what TTL expiry should bound suggests either a key
pattern without a TTL being set somewhere, or genuinely higher event
volume than provisioned for.

**Resolution:**
1. `redis-cli --scan --pattern 'fp:dedup:event:*' | wc -l` to estimate
   dedup-key volume, compare against expected daily webhook volume × 7.
2. `redis-cli --bigkeys` to check for any unexpectedly large individual
   keys unrelated to the dedup pattern.
3. Check for any newly-added cache usage across services that might be
   `SET`ting keys without an `EX`/TTL argument.

### Symptom: Redis connection refused from a specific pod

**Cause:** NetworkPolicy misconfiguration (should allow same-namespace
egress by default across the fleet) or Redis pod itself down.

**Resolution:** Confirm Redis pod health independently first
(`kubectl get pods -l app=redis`) before assuming it's a per-service
NetworkPolicy regression — check whether *other* services can also reach
Redis at the same time to isolate whether it's Redis itself or one
pod's policy.
