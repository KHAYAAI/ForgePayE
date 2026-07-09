/**
 * Shared Postgres access for unified-router.
 *
 * Two exports, two call-site conventions found across this service:
 *
 *   `pool`  — raw pg.Pool. Used via `app.decorate('db', pool)` in index.ts;
 *             webhooks.ts/health.ts/events.ts call `.query(sql, params)`
 *             directly (2 args, tenant-agnostic — e.g. forgepay_events).
 *
 *   `db`    — tenant-scoped query wrapper. churn-prevention.ts,
 *             credit-bureau-education.ts, medium-risk-monitoring.ts,
 *             onboarding-analytics.ts, upsell-engine.ts, killbill-sync.ts,
 *             require-product middleware, and the bundle/csm/customer
 *             routes all call `db.query(tenantIdOrSchema, sql, params)`
 *             (3 args, first arg is a tenantId or the literal 'public').
 *
 * The 3-arg convention was designed for per-tenant Postgres schemas, but no
 * such provisioning ever shipped — there is no `CREATE SCHEMA` anywhere in
 * this service's migrations (just `forgepay_events`, `merchant_webhook_endpoints`,
 * `webhook_delivery_log` in the single shared `public` schema). All tenant
 * isolation actually happens via `WHERE customer_id = $1` / `tenant_id = $1`
 * filters in the SQL text itself. `db.query()` therefore accepts the legacy
 * first argument for source compatibility but intentionally ignores it
 * rather than attempting `SET search_path` to a schema that doesn't exist
 * (which would throw at runtime for every call site that isn't 'public').
 */

import type { Pool, QueryResultRow } from 'pg';
import { createDbPool } from '../lib/db.js';
import { config } from '../config.js';

export const pool: Pool = createDbPool(config.postgres);

export const db = {
  async query<T extends QueryResultRow = QueryResultRow>(
    _tenantIdOrSchema: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ rows: T[]; rowCount: number | null }> {
    const result = await pool.query<T>(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  },
};
