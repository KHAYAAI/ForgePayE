/**
 * Leader election for the gateway's background workers (settlement poller, payout worker, sweeper,
 * treasury manager).
 *
 * Run two gateway replicas for availability and, without this, both would sweep the same deposit,
 * top up the same wallet twice and race on the same payout. The workers are mostly idempotent, but
 * "mostly" is not what you want near a wallet. So one replica at a time holds a Postgres advisory
 * lock and runs the workers; the others serve HTTP and wait.
 *
 * It is a SESSION-level lock on a dedicated connection, so Postgres releases it by itself the moment
 * that connection dies (process crash, network cut, failover). A new leader takes over within one
 * retry interval, without any timeout we have to tune and without a stale lease anyone can forget.
 *
 * What it does NOT promise: a leader that has lost its connection may finish the pass it was in
 * before it notices. Passes are therefore still safe to overlap — payouts are claimed in the database
 * and reconciled by transaction hash; sweeps and treasury moves are state machines — the lock only
 * stops them overlapping routinely.
 */
import { Client, ClientConfig } from 'pg';

/** The subset of a pg Client the lock needs (so it can be tested without a live database). */
export interface LockConnection {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
  on(event: 'error' | 'end', cb: (err?: Error) => void): unknown;
}

export interface LeaderOptions {
  /** Lock name; replicas that use the same name compete. */
  name?: string;
  retryMs?: number;
  /** Called on every change. */
  onChange?: (isLeader: boolean) => void;
  log?: (msg: string) => void;
}

export interface LeaderLock {
  isLeader(): boolean;
  /** Resolves once this replica has been the leader at least once (or the lock was stopped). */
  start(): void;
  stop(): Promise<void>;
  status(): { leader: boolean; since: string | null; name: string; lastError: string | null };
}

export function createLeaderLock(connect: () => LockConnection, opts: LeaderOptions = {}): LeaderLock {
  const name = opts.name ?? 'forge-stablecoin-gateway-workers';
  const retryMs = opts.retryMs ?? 5000;
  const log = opts.log ?? ((m) => console.log(`[leader] ${m}`));
  let leader = false;
  let since: Date | null = null;
  let lastError: string | null = null;
  let conn: LockConnection | null = null;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let busy = false;

  const set = (v: boolean) => {
    if (v === leader) return;
    leader = v;
    since = v ? new Date() : null;
    log(v ? `this replica is now the leader for "${name}": background workers run here` : `leadership of "${name}" lost: background workers paused here`);
    opts.onChange?.(v);
  };

  const drop = async () => {
    const c = conn;
    conn = null;
    set(false);
    if (c) { try { await c.end(); } catch { /* already gone */ } }
  };

  const tick = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      if (!conn) {
        const c = connect();
        c.on('error', (e) => { lastError = e?.message ?? 'connection error'; void drop(); });
        c.on('end', () => { if (conn === c) void drop(); });
        await c.connect();
        conn = c;
      }
      if (leader) {
        // Still hold it? A cheap query also detects a half-dead connection.
        await conn.query('SELECT 1');
      } else {
        const r = await conn.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS got', [name]);
        if (r.rows[0]?.['got'] === true) set(true);
      }
      lastError = null;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      await drop();
    } finally {
      busy = false;
    }
  };

  return {
    isLeader: () => leader,
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { void tick(); }, retryMs);
      timer.unref?.();
      void tick();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
      await drop();
    },
    status: () => ({ leader, since: since?.toISOString() ?? null, name, lastError }),
  };
}

/** A lock over a dedicated connection built from the gateway's database settings. */
export function createPgLeaderLock(cfg: ClientConfig, opts: LeaderOptions = {}): LeaderLock {
  return createLeaderLock(() => new Client({ ...cfg, connectionTimeoutMillis: 5000 }) as unknown as LockConnection, opts);
}

/** Leader election is on unless LEADER_LOCK_ENABLED=false. Returns a gate for the workers. */
export function leaderEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['LEADER_LOCK_ENABLED'] !== 'false';
}
