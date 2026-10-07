/**
 * Institutions registered before the first agent survive a restart.
 *
 * Hydration treated a database as "fresh" whenever it held no agent profiles, so a production database that already held
 * institutions (and their API keys, and any keys they had rotated) skipped hydration on restart and silently lost all of
 * them. A mock cannot show that: the fault is in how the store reads the database back, so this runs against a real one.
 * Skips when no DATABASE_URL is configured; CI supplies a Postgres service container.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashApiKey } from './hash';
import { issueKey, matchKey, PRIMARY_KEY_ID, revokeKey } from './contributor-keys';
import type { DataContributor } from './types';

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const suite = HAS_DB ? describe : describe.skip;

type Store = typeof import('./store');
type Db = typeof import('./db');
let store: Store;
let db: Db;

const settle = () => new Promise((r) => setTimeout(r, 500));

suite('institutions survive a restart when no agent exists yet', () => {
  beforeAll(async () => {
    store = await import('./store');
    db = await import('./db');
    await store.initPersistence();
    // Nothing but institutions: exactly the state a launch starts in.
    await db.pool.query(
      'TRUNCATE agent_credit_profiles, credit_disputes, credit_reports, lender_reports, data_contributors, furnisher_attributions, bureau_subscriptions, furnisher_credit_balances',
    );
  });

  afterAll(async () => {
    await db.pool.query('TRUNCATE data_contributors');
    await db.pool.end();
  });

  it('keeps the institution, its rotated keys and its revocations; does not seed demo data over them', async () => {
    const c: DataContributor = {
      id: 'inst_restart_1', name: 'Restart MFI', type: 'defi_protocol', apiKeyHash: hashApiKey('ck_registration'),
      permissions: ['pull_scores'], queriesUsed: 0, queriesAllowed: 5000, dataRecordsContributed: 0,
      createdAt: '2026-10-01T00:00:00.000Z', status: 'active',
    };
    const issued = issueKey(c, { label: 'second' });
    if (!issued.ok) throw new Error('expected ok');
    expect(revokeKey(c, PRIMARY_KEY_ID, false).ok).toBe(true);
    store.setContributor(c);
    await settle();

    // A pod restart: the in-memory read model is gone.
    store.contributors.clear();
    store.profiles.clear();
    await store.initPersistence();

    const back = store.getContributor('inst_restart_1');
    expect(back, 'the institution was lost on restart').toBeDefined();
    if (!back) return;
    expect(matchKey(back, hashApiKey(issued.rawKey))).toBe(issued.key.id);   // the rotated-in key still works
    expect(matchKey(back, hashApiKey('ck_registration'))).toBeNull();        // the revoked one still does not
    expect(store.profiles.size).toBe(0);                                      // and no demo agents appeared
    expect(store.contributors.size).toBe(1);                                  // nor demo furnishers
  });
});
