import { Pool, type QueryResultRow } from 'pg';

/**
 * Postgres pool for the dashboard's own auth state — sessions, MFA factors,
 * SSO linkage, and the audit trail. Merchant identity itself still lives in
 * mor-layer; see lib/merchants.ts for how the two relate.
 */

const pool = new Pool({
  connectionString: process.env['DATABASE_URL'],
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// An idle client erroring out (server restart, network blip) emits on the pool
// rather than on the caller. Without a listener Node treats it as an unhandled
// 'error' event and takes the process down.
pool.on('error', (err: Error) => {
  console.error('[db] idle client error:', err);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as never);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/** Returns the number of rows affected — used by the revoke/consume paths. */
export async function execute(sql: string, params?: unknown[]): Promise<number> {
  const result = await pool.query(sql, params as never);
  return result.rowCount ?? 0;
}

export async function close(): Promise<void> {
  await pool.end();
}
