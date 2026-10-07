/**
 * Spent and revoked consent tokens are durable.
 *
 * They were held only in memory, so a restart made a revoked consent work again and let a used one be replayed for the
 * rest of its lifetime. The unit tests cover the hooks; the database test (skipped without DATABASE_URL, run in CI against
 * Postgres) restarts for real.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetConsentState, consumeConsentDurable, hydrateConsentState, issueConsent, isSpent, revokeConsentDurable,
  setConsentPersistence, verifyConsent, type ConsentPurpose,
} from './consent';

const PULL = { agentId: 'agent_prime_001', requestorId: 'lender_x', purpose: 'credit_application' as ConsentPurpose };

beforeEach(() => { __resetConsentState(); setConsentPersistence(null); });

describe('write-through hooks', () => {
  it('spending and revoking are written before the call returns', async () => {
    const writes: Array<[string, string, number]> = [];
    setConsentPersistence({ write: async (state, jti, exp) => { writes.push([state, jti, exp]); } });
    await consumeConsentDurable('jti-spent', 2_000_000_000);
    await revokeConsentDurable('jti-revoked', 2_000_000_100);
    expect(writes).toEqual([['spent', 'jti-spent', 2_000_000_000], ['revoked', 'jti-revoked', 2_000_000_100]]);
    expect(isSpent('jti-spent')).toBe(true);
  });

  it('works with no persistence configured (memory only)', async () => {
    await consumeConsentDurable('jti-1', 2_000_000_000);
    expect(isSpent('jti-1')).toBe(true);
  });
});

describe('hydration after a restart', () => {
  it('a revoked token is refused again, and a used token cannot be replayed', () => {
    const revoked = issueConsent(PULL);
    const used = issueConsent(PULL);
    const fresh = issueConsent(PULL);

    // The process restarts: memory is empty except for what was loaded back from storage.
    __resetConsentState();
    hydrateConsentState([
      { jti: revoked.payload.jti, state: 'revoked', exp: revoked.payload.exp },
      { jti: used.payload.jti, state: 'spent', exp: used.payload.exp },
    ]);

    expect(verifyConsent({ token: revoked.token, ...PULL })).toMatchObject({ valid: false, reason: 'revoked' });
    expect(verifyConsent({ token: used.token, ...PULL })).toMatchObject({ valid: false, reason: 'already_used' });
    expect(verifyConsent({ token: fresh.token, ...PULL }).valid).toBe(true); // an unrelated token is untouched
  });

  it('hydrating replaces what was in memory rather than adding to it', () => {
    hydrateConsentState([{ jti: 'a', state: 'spent', exp: 2_000_000_000 }]);
    hydrateConsentState([{ jti: 'b', state: 'spent', exp: 2_000_000_000 }]);
    expect(isSpent('a')).toBe(false);
    expect(isSpent('b')).toBe(true);
  });
});

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? describe : describe.skip;

dbSuite('against a real database', () => {
  type Store = typeof import('./store');
  type Db = typeof import('./db');
  let store: Store;
  let db: Db;

  beforeAll(async () => {
    store = await import('./store');
    db = await import('./db');
    await store.initPersistence();
    await db.pool.query('TRUNCATE consent_tokens');
  });
  afterAll(async () => {
    await db.pool.query('TRUNCATE consent_tokens');
    setConsentPersistence(null);
    await db.pool.end();
  });

  it('keeps a revoked and a spent token across a restart, and prunes long-expired rows', async () => {
    await store.initPersistence(); // installs the write-through hook (the shared beforeEach clears it)
    const revoked = issueConsent(PULL);
    const used = issueConsent(PULL);
    await revokeConsentDurable(revoked.payload.jti, revoked.payload.exp);
    await consumeConsentDurable(used.payload.jti, used.payload.exp);
    // an old row that should be pruned on the next load
    await db.pool.query(`INSERT INTO consent_tokens (jti, state, exp) VALUES ('ancient', 'spent', $1)`, [Math.floor(Date.now() / 1000) - 3 * 86_400]);

    await new Promise((r) => setTimeout(r, 300));
    __resetConsentState();                 // the pod restarts
    await store.initPersistence();

    expect(verifyConsent({ token: revoked.token, ...PULL })).toMatchObject({ valid: false, reason: 'revoked' });
    expect(verifyConsent({ token: used.token, ...PULL })).toMatchObject({ valid: false, reason: 'already_used' });
    const left = await db.pool.query(`SELECT jti FROM consent_tokens WHERE jti = 'ancient'`);
    expect(left.rowCount).toBe(0);
  });
});

describe('POST /v1/consent/status', () => {
  const ADMIN = 'dev-bureau-admin-key';
  const AAVE = 'ck_aave_live_xxx';
  const json = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

  it('tells an operator which tokens are unused, spent or revoked; an institution may not ask', async () => {
    const { buildApp } = await import('./index');
    const app = await buildApp();
    await app.ready();
    try {
      const a = issueConsent(PULL), b = issueConsent(PULL), c = issueConsent(PULL);
      await consumeConsentDurable(b.payload.jti, b.payload.exp);
      await revokeConsentDurable(c.payload.jti, c.payload.exp);

      const res = await app.inject({ method: 'POST', url: '/v1/consent/status', headers: json(ADMIN), payload: { jtis: [a.payload.jti, b.payload.jti, c.payload.jti] } });
      expect(res.statusCode).toBe(200);
      expect(res.json().data).toEqual({ [a.payload.jti]: 'unused', [b.payload.jti]: 'spent', [c.payload.jti]: 'revoked' });

      const denied = await app.inject({ method: 'POST', url: '/v1/consent/status', headers: json(AAVE), payload: { jtis: [a.payload.jti] } });
      expect(denied.statusCode).toBe(403);
      const bad = await app.inject({ method: 'POST', url: '/v1/consent/status', headers: json(ADMIN), payload: { jtis: [] } });
      expect(bad.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});
