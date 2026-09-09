/**
 * The furnisher ledger, subscriptions and credit balances survive a restart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this is an integration test and not a unit test
 *
 * These three maps were the last state in the service held only in memory, and
 * what they hold is money: what the bureau owes its furnishers, the inquiry
 * credits it has issued them, and the plans customers have already paid for. A
 * restart discharged real debts with no record they had ever existed, and
 * silently downgraded every paying subscriber to the default plan — which is a
 * billing fault, not an outage, because an unsubscribed caller falls back to
 * pay-as-you-go at list.
 *
 * A mock cannot prove that is fixed. The failure lived in the seam between the
 * store and Postgres — a missing upsert and a missing loader — and mocking
 * either side asserts the seam works by assuming it. So this runs the real
 * migration against a real database, writes through the real mutators, drops
 * the maps the way a pod restart does, and re-hydrates.
 *
 * Skips when no DATABASE_URL is configured, so local and offline runs stay
 * green. CI supplies a Postgres service container.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AttributionEntry, Subscription, CreditBalance } from './types';

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const suite = HAS_DB ? describe : describe.skip;

// store.ts decides at module load whether to seed in memory, so the database
// has to be configured before it is imported — hence dynamic import.
type Store = typeof import('./store');
type Db = typeof import('./db');
type Payouts = typeof import('./furnisher-payouts');

let store: Store;
let db: Db;
let payouts: Payouts;

const PERIOD = '2026-08';

function entry(over: Partial<AttributionEntry> = {}): AttributionEntry {
  return {
    id: 'attr_persist_1',
    contributorId: 'contrib_persist_aave',
    reportId: 'rep_persist_1',
    agentId: 'agent_prime_001',
    share: 1,
    amountUsdCents: 42,
    creditsAccrued: 0,
    phase: 'cash',
    createdAt: '2026-08-15T00:00:00Z',
    ...over,
  };
}

/** Write-through is fire-and-forget; give it a moment to land. */
const settle = () => new Promise((r) => setTimeout(r, 400));

async function restart(): Promise<void> {
  store.attributions.clear();
  store.subscriptions.clear();
  store.creditBalances.clear();
  await store.initPersistence();
}

suite('persistence across a restart', () => {
  beforeAll(async () => {
    store = await import('./store');
    db = await import('./db');
    payouts = await import('./furnisher-payouts');

    await store.initPersistence();
    // Start from a known state without disturbing the other tables.
    await db.pool.query(
      'TRUNCATE furnisher_attributions, bureau_subscriptions, furnisher_credit_balances',
    );
    await restart();
  });

  afterAll(async () => {
    if (HAS_DB && db) await db.pool.end();
  });

  it('keeps a furnisher attribution, to the cent', async () => {
    store.recordAttribution(entry());
    await settle();
    await restart();

    const back = store.attributions.get('attr_persist_1');
    expect(back).toBeDefined();
    expect(back!.amountUsdCents).toBe(42);
    expect(back!.phase).toBe('cash');
    expect(back!.contributorId).toBe('contrib_persist_aave');
  });

  it('keeps a reversal as a record rather than losing the row', async () => {
    // A clawback has to leave a trace. If a reversed entry simply vanished,
    // the dispute that caused it would be unauditable.
    store.recordAttribution(entry({
      id: 'attr_persist_reversed',
      reversedAt: '2026-08-20T00:00:00Z',
      reversalReason: 'disputed',
    }));
    await settle();
    await restart();

    const back = store.attributions.get('attr_persist_reversed');
    expect(back).toBeDefined();
    // Compare the instant, not the spelling: the round trip is allowed to
    // normalise "…00Z" to "…00.000Z", and asserting on the format would make
    // this test fail for a reason that has nothing to do with the money.
    expect(new Date(back!.reversedAt!).getTime()).toBe(Date.parse('2026-08-20T00:00:00Z'));
    expect(back!.reversalReason).toBe('disputed');
  });

  it('keeps a paid subscriber on their plan instead of the default', async () => {
    // The billing consequence: without this the customer loses the bundled
    // allocation they paid for and starts being charged per pull at list.
    const sub: Subscription = {
      requestorId: 'req_persist_bank',
      planId: 'institutional',
      periodStartedAt: '2026-01-01T00:00:00Z',
      pullsUsedThisPeriod: 1234,
      status: 'active',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    store.setSubscription(sub);
    await settle();
    await restart();

    const back = store.subscriptions.get('req_persist_bank');
    expect(back?.planId).toBe('institutional');
    expect(back?.pullsUsedThisPeriod).toBe(1234);
  });

  it('keeps inquiry credit balances, including fractions', async () => {
    // Reciprocity credits are fractional by construction — a $0.70 share at
    // list becomes 0.5 credits — so rounding them on the way to the database
    // would quietly shrink what a furnisher is owed.
    const bal: CreditBalance = {
      contributorId: 'contrib_persist_x402',
      creditsAvailable: 12.5,
      creditsRedeemed: 3,
      creditsExpired: 0.5,
      oldestUnexpiredAt: '2026-06-01T00:00:00Z',
      updatedAt: '2026-09-01T00:00:00Z',
    };
    store.setCreditBalance(bal);
    await settle();
    await restart();

    const back = store.creditBalances.get('contrib_persist_x402');
    expect(back?.creditsAvailable).toBe(12.5);
    expect(back?.creditsRedeemed).toBe(3);
    expect(back?.creditsExpired).toBe(0.5);
  });

  it('lets the settlement run still see exactly what is owed', async () => {
    store.recordAttribution(entry({ id: 'attr_persist_owed', contributorId: 'contrib_persist_owed' }));
    store.recordAttribution(entry({
      id: 'attr_persist_owed_reversed',
      contributorId: 'contrib_persist_owed',
      reversedAt: '2026-08-21T00:00:00Z',
    }));
    await settle();
    await restart();

    const owed = payouts.unsettledEntriesFor('contrib_persist_owed', PERIOD);
    expect(owed).toHaveLength(1);
    expect(owed[0]!.id).toBe('attr_persist_owed');
  });

  it('remembers that an entry was already paid, so a re-run cannot pay twice', async () => {
    // The settled stamp is the only thing between a repeated settlement run
    // and a second transfer, so it has to survive the restart as well.
    store.recordAttribution(entry({ id: 'attr_persist_paid', contributorId: 'contrib_persist_paid' }));
    await settle();

    const written = store.attributions.get('attr_persist_paid')!;
    store.recordAttribution({ ...written, settlementId: 'run_persist_1', settledAt: '2026-09-01T00:00:00Z' });
    await settle();
    await restart();

    expect(store.attributions.get('attr_persist_paid')?.settlementId).toBe('run_persist_1');
    expect(payouts.unsettledEntriesFor('contrib_persist_paid', PERIOD)).toHaveLength(0);
  });
});
