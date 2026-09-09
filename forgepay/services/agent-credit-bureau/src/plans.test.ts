/**
 * Plans, entitlement and volume pricing.
 *
 * The load-bearing assertion in this file is the last one: a volume discount
 * must never reach the furnisher pool. Everything else is arithmetic; that one
 * is the rule that keeps the data network intact while the bureau discounts to
 * win large customers.
 */

import { describe, it, expect } from 'vitest';
import {
  PLANS, getPlan, planAnnualUsdCents, priceNextPullUsd, entitlementForNextPull,
  periodHasLapsed, LIST_INQUIRY_USD, FURNISHER_SHARE_OF_LIST_USD, VOLUME_BANDS,
} from './plans';
import type { Subscription, PlanId } from './types';

function sub(planId: PlanId, pullsUsedThisPeriod = 0, periodStartedAt = new Date().toISOString()): Subscription {
  return {
    requestorId: 'req_test',
    planId,
    periodStartedAt,
    pullsUsedThisPeriod,
    status: 'active',
    createdAt: periodStartedAt,
    updatedAt: periodStartedAt,
  };
}

describe('plan catalogue', () => {
  it('prices every paid tier in whole USD cents', () => {
    for (const plan of Object.values(PLANS)) {
      expect(Number.isInteger(plan.monthlyUsdCents)).toBe(true);
    }
  });

  it('rises monotonically in price and in bundled allocation', () => {
    const order: PlanId[] = ['observer', 'growth', 'institutional', 'network'];
    for (let i = 1; i < order.length; i++) {
      expect(PLANS[order[i]].monthlyUsdCents).toBeGreaterThan(PLANS[order[i - 1]].monthlyUsdCents);
      expect(PLANS[order[i]].bundledPullsPerYear).toBeGreaterThanOrEqual(PLANS[order[i - 1]].bundledPullsPerYear);
    }
  });

  it('puts the institutional tier where ~5 customers cover the operating anchor', () => {
    // The whole point of enterprise pricing: 36 subscribers becomes a handful.
    const ANCHOR_USD = 198_000;
    const annualUsd = planAnnualUsdCents('institutional') / 100;
    expect(Math.ceil(ANCHOR_USD / annualUsd)).toBeLessThanOrEqual(5);
  });

  it('keeps the free tier genuinely free and hard-pull-free', () => {
    const observer = getPlan('observer');
    expect(observer.monthlyUsdCents).toBe(0);
    expect(observer.hardPullsAllowed).toBe(false);
    expect(observer.bundledPullsPerYear).toBe(0);
  });
});

describe('volume pricing', () => {
  it('charges list for the first band', () => {
    expect(priceNextPullUsd(0)).toBe(LIST_INQUIRY_USD);
    expect(priceNextPullUsd(4_999)).toBe(2.80);
  });

  it('steps down at each band boundary', () => {
    expect(priceNextPullUsd(5_000)).toBe(2.40);
    expect(priceNextPullUsd(24_999)).toBe(2.40);
    expect(priceNextPullUsd(25_000)).toBe(2.00);
    expect(priceNextPullUsd(10_000_000)).toBe(2.00);
  });

  it('never prices a pull at zero, even past the last band', () => {
    for (const n of [0, 1, 5_000, 25_000, Number.MAX_SAFE_INTEGER - 1]) {
      expect(priceNextPullUsd(n)).toBeGreaterThan(0);
    }
  });

  it('orders its bands ascending, so the lookup cannot skip one', () => {
    for (let i = 1; i < VOLUME_BANDS.length; i++) {
      expect(VOLUME_BANDS[i].upTo).toBeGreaterThan(VOLUME_BANDS[i - 1].upTo);
      expect(VOLUME_BANDS[i].pricePerPullUsd).toBeLessThan(VOLUME_BANDS[i - 1].pricePerPullUsd);
    }
  });
});

describe('entitlement', () => {
  it('refuses a hard pull on the free tier', () => {
    const e = entitlementForNextPull(sub('observer'));
    expect(e.kind).toBe('refused');
  });

  it('sells a pull at list to a caller with no subscription', () => {
    // Pay-as-you-go is a published product, not an oversight: the bureau quotes
    // a per-pull price to callers who will never sign a contract. Refusing them
    // would have withdrawn that product in the name of tiering.
    const e = entitlementForNextPull(undefined);
    expect(e.kind).toBe('paid');
    if (e.kind !== 'paid') throw new Error('unreachable');
    expect(e.priceUsd).toBe(LIST_INQUIRY_USD);
  });

  it('never lets an unsubscribed caller inherit a paid plan\'s bundled allocation', () => {
    // The actual fail-closed requirement. Pay-as-you-go is fine; free inquiries
    // that nobody bought are not.
    const e = entitlementForNextPull(undefined);
    expect(e.kind).not.toBe('bundled');
  });

  it('spends the bundled allocation before touching the prepaid balance', () => {
    const e = entitlementForNextPull(sub('institutional', 0));
    expect(e.kind).toBe('bundled');
    if (e.kind !== 'bundled') throw new Error('unreachable');
    expect(e.remainingAfter).toBe(PLANS.institutional.bundledPullsPerYear - 1);
  });

  it('switches to cash on the pull after the allocation is exhausted', () => {
    const bundle = PLANS.growth.bundledPullsPerYear;
    expect(entitlementForNextPull(sub('growth', bundle - 1)).kind).toBe('bundled');

    const e = entitlementForNextPull(sub('growth', bundle));
    expect(e.kind).toBe('paid');
    if (e.kind !== 'paid') throw new Error('unreachable');
    expect(e.priceUsd).toBe(LIST_INQUIRY_USD);
  });

  it('applies volume banding only to pulls bought beyond the bundle', () => {
    // 2,500 bundled + 5,000 paid ⇒ the next paid pull is in the second band.
    const used = PLANS.institutional.bundledPullsPerYear + 5_000;
    const e = entitlementForNextPull(sub('institutional', used));
    if (e.kind !== 'paid') throw new Error('expected a paid entitlement');
    expect(e.priceUsd).toBe(2.40);
  });
});

describe('entitlement period', () => {
  it('has not lapsed inside the year', () => {
    const started = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000).toISOString();
    expect(periodHasLapsed(sub('growth', 10, started))).toBe(false);
  });

  it('has lapsed after a year', () => {
    const started = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString();
    expect(periodHasLapsed(sub('growth', 10, started))).toBe(true);
  });
});

describe('the furnisher pool is immune to volume discounts', () => {
  it('pays 25% of list regardless of what the buyer paid', () => {
    // The rule this whole pricing model depends on. Discounting to win a large
    // customer must come out of the bureau's margin, never out of the income of
    // the furnishers whose data made the product worth buying.
    expect(FURNISHER_SHARE_OF_LIST_USD).toBeCloseTo(LIST_INQUIRY_USD * 0.25, 10);
    expect(FURNISHER_SHARE_OF_LIST_USD).toBeCloseTo(0.70, 10);

    // The furnisher share is a single constant that no band can reach: the
    // margin moves, the payout does not.
    const marginsByBand = VOLUME_BANDS.map(b => b.pricePerPullUsd - FURNISHER_SHARE_OF_LIST_USD);

    for (const margin of marginsByBand) {
      expect(margin).toBeGreaterThan(0);
      expect(margin).toBeLessThanOrEqual(LIST_INQUIRY_USD - FURNISHER_SHARE_OF_LIST_USD);
    }
    // Margins fall across bands while the furnisher share stays put.
    for (let i = 1; i < marginsByBand.length; i++) {
      expect(marginsByBand[i]).toBeLessThan(marginsByBand[i - 1]);
    }
  });

  it('still leaves the bureau a positive margin at the deepest discount', () => {
    const deepest = VOLUME_BANDS[VOLUME_BANDS.length - 1].pricePerPullUsd;
    expect(deepest - FURNISHER_SHARE_OF_LIST_USD).toBeCloseTo(1.30, 2);
  });
});
