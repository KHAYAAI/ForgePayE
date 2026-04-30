import { Pool } from 'pg';
import { config } from '../config.js';

let _pool: Pool | null = null;

export function getDb(): Pool {
  if (!_pool) {
    _pool = new Pool({
      ...config.postgres,
      max: 10,
      idleTimeoutMillis:       30_000,
      connectionTimeoutMillis:  5_000,
    });
    _pool.on('error', (err) => console.error('[accounts-service] PG pool error', err));
  }
  return _pool;
}
