/**
 * Durable state for the decision framework.
 *
 * Policies, per-agent limits, the spend-velocity ledger and the decision log lived only in memory, so a restart:
 *  - reset every agent's rolling spend window, which makes a velocity limit a limit only until the next deploy;
 *  - dropped every policy and per-agent override an operator had set, restoring the defaults;
 *  - lost the decision history.
 *
 * Now they are written through to Postgres and loaded at start. The write is fire-and-forget with retries so the request path
 * stays synchronous; a write that fails after its retries is counted (see persistenceFailures, shown on /health) rather than lost
 * silently. A crash in the few milliseconds before a write lands can still drop that one record.
 *
 * Configure with DATABASE_URL or DB_HOST. With neither, the service runs in memory (development). In production it refuses to start
 * without one: a spend limit that forgets is not a limit.
 */

import { Pool } from 'pg';
import type { AgentPolicy, Decision, DecisionPolicy } from './types';
import {
  hydratePolicies, setPolicySink, listDefaultPolicies,
} from './policies';
import { hydrateVelocity, setVelocitySink } from './velocity';
import { hydrateDecisions, setDecisionSink } from './decision-log';

const WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_LOG = 500;
const MAX_ATTEMPTS = 3;

export function isDbEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env['DATABASE_URL'] || env['DB_HOST']);
}

export function assertPersistenceConfigured(env: NodeJS.ProcessEnv = process.env): void {
  if (env['NODE_ENV'] === 'production' && !isDbEnabled(env)) {
    throw new Error(
      'The decision framework refuses to start in production without a database (set DATABASE_URL or DB_HOST): ' +
      'without one its spend limits, policies and decision log reset on every restart.',
    );
  }
}

let pool: Pool | null = null;
let failures = 0;
export const persistenceFailures = (): number => failures;

function getPool(): Pool {
  if (!pool) {
    pool = process.env['DATABASE_URL']
      ? new Pool({ connectionString: process.env['DATABASE_URL'], max: 10 })
      : new Pool({
          host: process.env['DB_HOST'] ?? 'localhost',
          port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
          user: process.env['DB_USER'] ?? 'postgres',
          password: process.env['DB_PASSWORD'] ?? 'postgres',
          database: process.env['DB_NAME'] ?? 'forgepay',
          max: parseInt(process.env['DB_POOL_MAX'] ?? '10', 10),
        });
    pool.on('error', (err) => console.error('[agent-decision] postgres pool error', err));
  }
  return pool;
}

export async function closePool(): Promise<void> {
  await pool?.end();
  pool = null;
}

async function persist(what: string, write: () => Promise<unknown>): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await write();
      return;
    } catch (e) {
      if (attempt === MAX_ATTEMPTS) {
        failures += 1;
        console.error(`[agent-decision] failed to persist ${what}:`, e);
        return;
      }
      await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
}

export async function runMigrations(): Promise<void> {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS decision_policies (
      id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS decision_agent_policies (
      agent_id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS decision_velocity (
      id BIGSERIAL PRIMARY KEY, agent_id TEXT NOT NULL, ts BIGINT NOT NULL, amount_usd DOUBLE PRECISION NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_velocity_agent_ts ON decision_velocity(agent_id, ts);
    CREATE TABLE IF NOT EXISTS decision_log (
      seq BIGSERIAL PRIMARY KEY, data JSONB NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Remembers that the default policies were written once, so deleting them on purpose is not undone at the next start.
    CREATE TABLE IF NOT EXISTS decision_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
}

/** Migrate, load everything back into memory, and start writing changes through. Call before listening. */
export async function initPersistence(): Promise<void> {
  assertPersistenceConfigured();
  if (!isDbEnabled()) return;
  const db = getPool();
  await runMigrations();

  const seeded = await db.query(`SELECT 1 FROM decision_meta WHERE key = 'defaults_seeded'`);
  if (seeded.rowCount === 0) {
    for (const p of listDefaultPolicies()) {
      await db.query(
        `INSERT INTO decision_policies (id, data) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [p.id, JSON.stringify(p)],
      );
    }
    await db.query(`INSERT INTO decision_meta (key, value) VALUES ('defaults_seeded', 'yes') ON CONFLICT DO NOTHING`);
  }

  const cutoff = Date.now() - WINDOW_7D_MS;
  await db.query(`DELETE FROM decision_velocity WHERE ts < $1`, [cutoff]);
  await db.query(`DELETE FROM decision_log WHERE seq <= (SELECT COALESCE(MAX(seq), 0) - $1 FROM decision_log)`, [MAX_LOG]);

  const [pol, agent, vel, log] = await Promise.all([
    db.query<{ data: DecisionPolicy }>(`SELECT data FROM decision_policies ORDER BY updated_at, id`),
    db.query<{ data: AgentPolicy }>(`SELECT data FROM decision_agent_policies`),
    db.query<{ agent_id: string; ts: string; amount_usd: number }>(`SELECT agent_id, ts, amount_usd FROM decision_velocity WHERE ts >= $1 ORDER BY ts`, [cutoff]),
    db.query<{ data: Decision }>(`SELECT data FROM decision_log ORDER BY seq DESC LIMIT $1`, [MAX_LOG]),
  ]);
  hydratePolicies(pol.rows.map((r) => r.data), agent.rows.map((r) => r.data));
  hydrateVelocity(vel.rows.map((r) => ({ agentId: r.agent_id, timestamp: Number(r.ts), amountUsd: Number(r.amount_usd) })));
  hydrateDecisions(log.rows.map((r) => r.data).reverse());

  let sinceTrim = 0;
  setPolicySink({
    upsertPolicy: (p) => void persist('policy', () => db.query(
      `INSERT INTO decision_policies (id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [p.id, JSON.stringify(p)])),
    removePolicy: (id) => void persist('policy removal', () => db.query(`DELETE FROM decision_policies WHERE id = $1`, [id])),
    upsertAgentPolicy: (p) => void persist('agent policy', () => db.query(
      `INSERT INTO decision_agent_policies (agent_id, data, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (agent_id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`, [p.agentId, JSON.stringify(p)])),
  });
  setVelocitySink({
    record: (agentId, timestamp, amountUsd) => void persist('velocity entry', () => db.query(
      `INSERT INTO decision_velocity (agent_id, ts, amount_usd) VALUES ($1, $2, $3)`, [agentId, timestamp, amountUsd])),
  });
  setDecisionSink({
    record: (d) => void persist('decision', async () => {
      await db.query(`INSERT INTO decision_log (data) VALUES ($1)`, [JSON.stringify(d)]);
      if (++sinceTrim >= 100) {
        sinceTrim = 0;
        await db.query(`DELETE FROM decision_log WHERE seq <= (SELECT MAX(seq) - $1 FROM decision_log)`, [MAX_LOG]);
        await db.query(`DELETE FROM decision_velocity WHERE ts < $1`, [Date.now() - WINDOW_7D_MS]);
      }
    }),
  });
}

/** Test helper: detach the sinks so a later test does not write to a closed pool. */
export function detachPersistence(): void {
  setPolicySink(null);
  setVelocitySink(null);
  setDecisionSink(null);
}
