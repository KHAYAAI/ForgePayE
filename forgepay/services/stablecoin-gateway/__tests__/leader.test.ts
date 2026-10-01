import { describe, it, expect } from 'vitest';
import { Client } from 'pg';
import { createLeaderLock, createPgLeaderLock, type LockConnection } from '../src/lib/leader.js';

// A fake whose "database" grants the lock to one connection at a time, like Postgres does.
function fakeDb() {
  let holder: object | null = null;
  const conns: FakeConn[] = [];
  class FakeConn implements LockConnection {
    dead = false;
    handlers: Record<string, (e?: Error) => void> = {};
    async connect() { if (this.dead) throw new Error('refused'); }
    async query(sql: string) {
      if (this.dead) throw new Error('connection terminated');
      if (sql.includes('pg_try_advisory_lock')) {
        if (holder === null || holder === this) { holder = this; return { rows: [{ got: true }] }; }
        return { rows: [{ got: false }] };
      }
      return { rows: [{}] };
    }
    async end() { if (holder === this) holder = null; }
    on(ev: 'error' | 'end', cb: (e?: Error) => void) { this.handlers[ev] = cb; }
    kill() { this.dead = true; if (holder === this) holder = null; this.handlers['error']?.(new Error('terminated')); }
  }
  return { make: () => { const c = new FakeConn(); conns.push(c); return c; }, conns };
}
const settle = () => new Promise((r) => setTimeout(r, 40));

describe('leader lock', () => {
  it('lets exactly one of two replicas lead, and hands over when the leader dies', async () => {
    const db = fakeDb();
    const a = createLeaderLock(db.make, { retryMs: 10, log: () => {} });
    const b = createLeaderLock(db.make, { retryMs: 10, log: () => {} });
    a.start(); await settle();
    b.start(); await settle();
    expect(a.isLeader()).toBe(true);
    expect(b.isLeader()).toBe(false);
    db.conns[0]!.kill(); await settle(); // the leader's connection dies: the database releases the lock
    expect(a.isLeader()).toBe(false);
    await settle(); await settle();
    expect(b.isLeader()).toBe(true);
    expect(a.isLeader()).toBe(false); // the old leader reconnects but must not steal it back
    await a.stop(); await b.stop();
  });

  it('stop() releases leadership immediately for a graceful handover', async () => {
    const db = fakeDb();
    const a = createLeaderLock(db.make, { retryMs: 10, log: () => {} });
    const b = createLeaderLock(db.make, { retryMs: 10, log: () => {} });
    a.start(); await settle(); b.start(); await settle();
    await a.stop(); await settle(); await settle();
    expect(b.isLeader()).toBe(true);
    await b.stop();
  });

  it('is not leader while the database is unreachable', async () => {
    let fail = true;
    const db = fakeDb();
    const a = createLeaderLock(() => { const c = db.make(); if (fail) c.dead = true; return c; }, { retryMs: 10, log: () => {} });
    a.start(); await settle();
    expect(a.isLeader()).toBe(false);
    expect(a.status().lastError).toBeTruthy();
    fail = false; await settle(); await settle();
    expect(a.isLeader()).toBe(true);
    await a.stop();
  });
});

// The advisory lock itself, against a real Postgres, when one is configured.
const url = process.env['LEADER_TEST_PG_URL'];
describe.skipIf(!url)('leader lock on real Postgres', () => {
  it('only one of two replicas holds the lock, and a killed connection hands it over', async () => {
    const cfg = { connectionString: url };
    const name = `test-${Date.now()}`;
    const a = createPgLeaderLock(cfg, { name, retryMs: 100, log: () => {} });
    const b = createPgLeaderLock(cfg, { name, retryMs: 100, log: () => {} });
    a.start(); await new Promise((r) => setTimeout(r, 600));
    b.start(); await new Promise((r) => setTimeout(r, 600));
    expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1);
    const leaderIsA = a.isLeader();
    const admin = new Client(cfg); await admin.connect();
    await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_locks l WHERE l.locktype='advisory' AND l.granted AND pid <> pg_backend_pid()`);
    await admin.end();
    await new Promise((r) => setTimeout(r, 1800));
    expect([a.isLeader(), b.isLeader()].filter(Boolean)).toHaveLength(1);
    expect(leaderIsA ? b.isLeader() : a.isLeader()).toBe(true);
    await a.stop(); await b.stop();
  });
});
