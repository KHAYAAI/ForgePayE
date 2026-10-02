import { Inject, Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from './database.tokens';

/** SHA-256 of the public development key "dev-demo-key" (see infrastructure/init-dev-seed.sql). */
export const DEMO_KEY_HASH = '6cbae51c7775b973f845b3fb4b333495890ecc9c57a9c3b3d662a3200d3227e1';

/** In production, refuse to run against a database that still contains the public demo credential. */
export async function assertNoDemoCredential(pool: Pick<Pool, 'query'>, production: boolean): Promise<void> {
  if (!production) return;
  const { rows } = await pool.query(`SELECT customer_id FROM customers WHERE api_key = $1 LIMIT 1`, [DEMO_KEY_HASH]);
  if (rows.length > 0) {
    throw new Error(
      `the database contains the public demo API key (customer "${rows[0].customer_id}"). ` +
      `Delete that customer before running in production (it is seeded by infrastructure/init-dev-seed.sql, for development only).`,
    );
  }
}

@Injectable()
export class DemoCredentialGuard implements OnApplicationBootstrap {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationBootstrap() {
    await assertNoDemoCredential(this.pool, process.env.NODE_ENV === 'production');
  }
}
