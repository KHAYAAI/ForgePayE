import { Pool, QueryResult } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[db] pool error:', err);
});

export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const results = await query<T>(sql, params);
  return results.length > 0 ? results[0] : null;
}

export async function execute(sql: string, params?: any[]): Promise<number> {
  const result = await pool.query(sql, params);
  return result.rowCount ?? 0;
}

export async function close(): Promise<void> {
  await pool.end();
}
