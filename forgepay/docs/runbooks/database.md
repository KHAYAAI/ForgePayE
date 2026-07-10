# Runbook: Postgres Incident Response

## Shared Postgres (`forgepay-postgresql`, default port 5432)

Most TypeScript services in this fleet share one Postgres instance
(database `forgepay`, per-service tables — there is no schema-per-tenant
or schema-per-service isolation; everything lives in `public`). Python
services (mor-layer, compliance-monitor, liquidity-forecaster) use
SQLAlchemy/Alembic against the same instance.

### Symptom: A service's `/readyz` returns 503 with a database error

**Cause:** Either Postgres itself is down/unreachable, or that specific
service's connection pool is exhausted (`DB_POOL_MAX` too low for
current concurrency).

**Resolution:**
1. `kubectl exec -it <postgres-pod> -- psql -U forgepay -c 'SELECT 1'` —
   confirms Postgres itself is up, independent of any application pod.
2. If Postgres is up but one specific service still fails: check that
   service's pool metrics (`pg_stat_activity` filtered by
   `application_name` if set, or by matching connection count against
   `DB_POOL_MAX`) — a leaked-connection bug in that service (missing
   `client.release()` in a `finally` block) will exhaust its own pool
   while every other service stays healthy.
3. Check the service's own NetworkPolicy allows same-namespace egress to
   Postgres (should, by default — the fleet-wide NetworkPolicy pattern
   allows all same-namespace pod-to-pod traffic).

### Symptom: A service boots with an empty schema / "relation does not exist" errors

**Cause:** That service's `runMigrations()` either was never wired into
startup (a real, previously-shipped bug — verify it's fixed, don't
assume), or ran but failed silently in a dev-tolerant fallback path.

**Resolution:**
1. Check startup logs for a migrations-related log line — every service
   that uses Postgres should log either a successful migration run or an
   explicit "migrations failed, continuing (dev only)" warning.
2. `SELECT * FROM <service>_migrations` (or equivalent tracking table,
   naming varies per service) to see which migrations have actually
   applied.
3. Manually apply the missing `.sql` files from that service's
   `src/db/migrations/` directory in alphabetical order if an automatic
   re-run isn't safe to trigger (e.g. mid-incident, prefer a controlled
   manual apply over a pod restart that might race with live traffic).

### Symptom: Slow queries / high CPU on Postgres

**Cause:** Missing index on a hot query path, or a service running an
unbounded query (no `LIMIT`, scanning a large table like
`forgepay_events` without an index on the filtered column).

**Resolution:**
1. `SELECT * FROM pg_stat_activity WHERE state = 'active' ORDER BY
   query_start ASC` — find long-running queries.
2. `EXPLAIN ANALYZE` the offending query to confirm a missing index
   rather than guessing.
3. Check `forgepay/infra/k8s/migrations/*.sql` for the relevant table's
   existing indexes before adding a new one blind — some are already
   indexed and the actual issue may be query shape, not missing indexes.

### Symptom: Connection count approaching `max_connections`

**Cause:** With ~25 services each running their own pool
(`DB_POOL_MAX` default 20 in most services), total possible connections
across the fleet can exceed Postgres's `max_connections` even without any
single service leaking.

**Resolution:**
1. `SHOW max_connections;` vs. sum of every service's configured
   `DB_POOL_MAX` — if the sum exceeds the limit with room for
   replicas × pool size, this is a capacity-planning gap, not an
   incident-specific bug.
2. Consider a connection pooler (PgBouncer) in front of Postgres if the
   fleet grows further — not yet in place as of this writing.
