/**
 * Subscription plans and inquiry pricing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why this replaces a flat rate card
 *
 * The published price was R8,500/mo — roughly $459 — with an unlimited,
 * flat $2.80 per pull on top. Two problems, both arithmetic:
 *
 *   1. At $5,514/subscriber/year, covering a ~$198,000 operating budget needs
 *      36 signed customers. Reaching the same number through pull volume alone
 *      needs a 29% inquiry-to-event conversion rate against an "optimistic"
 *      case of 5%. Neither lever reaches the target because both were priced as
 *      though the buyer were small.
 *
 *   2. R8,500/mo is a productivity-tool price charged to banks and insurers.
 *      The named institutional buyers — bank white-label partners, underwriters
 *      — are not price-sensitive at that level; they are procurement-sensitive,
 *      and a line item that cheap reads as a tool rather than a data contract.
 *
 * Enterprise pricing in USD fixes both. At $48,000/year, the institutional tier
 * covers the same operating budget on roughly five customers instead of
 * thirty-six.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The one rule that keeps the furnisher network intact
 *
 * Volume discounts apply to what the *buyer* pays. They never apply to what the
 * *furnisher* earns — see FURNISHER_SHARE_OF_LIST_USD below. Discounting the
 * furnisher share alongside the buyer price would mean every large customer
 * won on price quietly cut the income of the furnishers whose data made the
 * product worth buying.
 */

import type { PlanId, Subscription } from './types';

// ── Inquiry pricing ───────────────────────────────────────────────────────────

/** List price of one hard inquiry. The published headline number. */
export const LIST_INQUIRY_USD = 2.80;

/**
 * What a furnisher earns per inquiry their data informed — 25% of *list*.
 *
 * Fixed to list rather than to the price actually charged. A pull sold at the
 * deepest volume tier still pays the furnisher pool $0.70; the bureau absorbs
 * the entire discount out of its own margin.
 */
export const FURNISHER_SHARE_OF_LIST_USD = LIST_INQUIRY_USD * 0.25;

/**
 * Volume pricing above a plan's bundled allocation, by trailing annual paid
 * volume. Bands are cumulative: the 5,001st pull in a year is priced at the
 * second band, not the whole year retroactively.
 */
export const VOLUME_BANDS: ReadonlyArray<{ upTo: number; pricePerPullUsd: number }> = [
  { upTo: 5_000,           pricePerPullUsd: 2.80 },
  { upTo: 25_000,          pricePerPullUsd: 2.40 },
  { upTo: Number.MAX_SAFE_INTEGER, pricePerPullUsd: 2.00 },
];

/**
 * Price the next single pull, given how many paid pulls the requestor has
 * already bought this period.
 *
 * Deliberately prices one pull at a time rather than a batch: the bureau
 * charges synchronously per report, so the only question it ever needs to
 * answer is "what does this one cost".
 */
export function priceNextPullUsd(paidPullsThisPeriod: number): number {
  for (const band of VOLUME_BANDS) {
    if (paidPullsThisPeriod < band.upTo) return band.pricePerPullUsd;
  }
  // Unreachable: the final band is unbounded. Falls back to list rather than
  // to free, because a pricing bug should never hand out inquiries.
  return LIST_INQUIRY_USD;
}

// ── Plans ─────────────────────────────────────────────────────────────────────

export interface Plan {
  id: PlanId;
  name: string;
  /** Integer USD cents per month. Zero for the free tier. */
  monthlyUsdCents: number;
  /** Hard pulls included per entitlement year, consumed before any cash debit. */
  bundledPullsPerYear: number;
  /** Whether this plan may pull full reports at all, or only soft-pull bands. */
  hardPullsAllowed: boolean;
  includes: string[];
  builtFor: string;
}

export const PLANS: Record<PlanId, Plan> = {
  observer: {
    id: 'observer',
    name: 'Observer',
    monthlyUsdCents: 0,
    bundledPullsPerYear: 0,
    hardPullsAllowed: false,
    includes: [
      'Unlimited soft pulls — grade band only',
      'Published grade scale and bureau statistics',
      'Simulation endpoint (records no inquiry)',
    ],
    builtFor: 'Access gating and offer sizing, where a band is enough',
  },

  growth: {
    id: 'growth',
    name: 'Growth',
    monthlyUsdCents: 100_000,      // $1,000/mo — $12,000/yr
    bundledPullsPerYear: 250,
    hardPullsAllowed: true,
    includes: [
      'Everything in Observer',
      '250 hard inquiries per year included',
      'Full reports, dual-mode scores and consensus',
      'Dispute filing and standard support',
      'Contributor onboarding',
    ],
    builtFor: 'Fintechs, smaller lending protocols and agent marketplaces',
  },

  institutional: {
    id: 'institutional',
    name: 'Institutional',
    monthlyUsdCents: 400_000,      // $4,000/mo — $48,000/yr
    bundledPullsPerYear: 2_500,
    hardPullsAllowed: true,
    includes: [
      'Everything in Growth',
      '2,500 hard inquiries per year included',
      'Zero-knowledge threshold proofs',
      'Priority dispute handling with a contractual SLA',
      'Named support contact',
    ],
    builtFor: 'Banks, insurers and lending protocols underwriting at volume',
  },

  network: {
    id: 'network',
    name: 'Network',
    monthlyUsdCents: 1_200_000,    // $12,000/mo floor — $144,000/yr
    bundledPullsPerYear: 10_000,
    hardPullsAllowed: true,
    includes: [
      'Everything in Institutional',
      '10,000 hard inquiries per year included',
      'White-label terms and multi-entity access',
      'Custom SLAs and dedicated onboarding',
      'Negotiated volume pricing above the allocation',
    ],
    builtFor: 'Bank white-label partners and multi-entity financial groups',
  },
};

export const DEFAULT_PLAN_ID: PlanId = 'observer';

export function getPlan(planId: PlanId): Plan {
  return PLANS[planId];
}

/** Annualised list price of a plan, in integer USD cents. */
export function planAnnualUsdCents(planId: PlanId): number {
  return PLANS[planId].monthlyUsdCents * 12;
}

// ── Entitlement ───────────────────────────────────────────────────────────────

export type PullEntitlement =
  | { kind: 'bundled'; remainingAfter: number }
  | { kind: 'paid'; priceUsd: number }
  | { kind: 'refused'; reason: 'plan_forbids_hard_pulls' };

/**
 * Decide how the next hard pull is paid for: out of the plan's bundled
 * allocation, or in cash at the volume-banded price.
 *
 * Bundled allocation is consumed first, deliberately. A subscriber who has paid
 * for 2,500 inquiries should exhaust them before their prepaid balance is
 * touched — the alternative silently double-charges someone who is already
 * paying for the same thing.
 */
export function entitlementForNextPull(sub: Subscription | undefined): PullEntitlement {
  const plan = PLANS[sub?.planId ?? DEFAULT_PLAN_ID];

  if (!plan.hardPullsAllowed) {
    return { kind: 'refused', reason: 'plan_forbids_hard_pulls' };
  }

  const used = sub?.pullsUsedThisPeriod ?? 0;
  if (used < plan.bundledPullsPerYear) {
    return { kind: 'bundled', remainingAfter: plan.bundledPullsPerYear - used - 1 };
  }

  // Past the bundle: volume pricing applies to pulls bought beyond it.
  const paidSoFar = used - plan.bundledPullsPerYear;
  return { kind: 'paid', priceUsd: priceNextPullUsd(paidSoFar) };
}

/** Whether an entitlement period has rolled over and should reset. */
export function periodHasLapsed(sub: Subscription, now = new Date()): boolean {
  const started = new Date(sub.periodStartedAt).getTime();
  if (Number.isNaN(started)) return false;
  const oneYearMs = 365 * 24 * 60 * 60 * 1000;
  return now.getTime() - started >= oneYearMs;
}
