/**
 * Furnisher compensation — cash for the first year, reciprocity after.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The problem this solves
 *
 * The bureau publishes a 25% revenue share to furnishers, and until now nothing
 * computed or paid it. The phrase in the prospectus — "apportioned by
 * contribution" — was never defined anywhere, which meant four different
 * plausible split rules and no way to tell a furnisher which one applied.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Why compensation changes shape after twelve months
 *
 * Traditional bureaus pay furnishers nothing. Banks report to Experian because
 * a bureau nobody feeds is a bureau nobody can use — reciprocity, not cash.
 * That model is stable at scale and completely useless at zero: a lending
 * protocol has no reason to build an integration against a network too thin to
 * be worth reading.
 *
 * So the first year is cash, and after that it is reciprocity:
 *
 *   Months 0–12   CASH.        Real dollars, 25% of list per inquiry the
 *                              furnisher's data informed. This is the
 *                              bootstrap, and it is deliberately expensive.
 *
 *   Month 13 on   RECIPROCITY. The same entitlement, denominated in inquiry
 *                              credits at list value rather than cash, with a
 *                              multiplier — the furnisher receives more nominal
 *                              value than the cash would have been, while the
 *                              bureau's real cost falls to marginal delivery.
 *
 * By month thirteen the network is either worth reading, in which case credits
 * are worth more to a lender than the cash was, or it is not, in which case the
 * cash was never going to save it.
 */

import { randomUUID } from 'crypto';
import type {
  AttributionEntry, CompensationPhase, CreditBalance,
  CreditEvent, CreditEventType, DataContributor,
} from './types';
import { FURNISHER_SHARE_OF_LIST_USD, LIST_INQUIRY_USD } from './plans';
import {
  getContributor, setContributor,
  getCreditBalance, setCreditBalance,
  recordAttribution, listAttributionsForReport,
} from './store';

// ── Phase ─────────────────────────────────────────────────────────────────────

/** How long a newly activated furnisher is paid in cash. */
export const COMPENSATION_CASH_MONTHS = 12;

/**
 * Nominal uplift applied when compensation is paid in credits rather than cash.
 *
 * A credit costs the bureau its marginal delivery cost — a sanctions screen, a
 * chain read, scoring compute — not the $2.80 it redeems for. Passing part of
 * that gap back to the furnisher makes reciprocity a better deal than the cash
 * it replaces, in the currency a lender actually wants, which is what stops the
 * month-thirteen switch reading as a pay cut.
 */
export const RECIPROCITY_MULTIPLIER = 2;

/** Credits expire twelve months after they are accrued. */
export const CREDIT_EXPIRY_MONTHS = 12;

function monthsBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso).getTime();
  if (Number.isNaN(from)) return 0;
  return (now.getTime() - from) / (30.44 * 24 * 60 * 60 * 1000);
}

/**
 * Which compensation phase a furnisher is in right now.
 *
 * A contributor with no `activatedAt` has never been activated and cannot have
 * furnished anything, so it is treated as being in its cash year rather than
 * silently skipped to reciprocity — the failure mode of a missing date should
 * favour the furnisher, not the bureau.
 */
export function compensationPhase(
  contributor: Pick<DataContributor, 'activatedAt' | 'cashEligibleOverride'>,
  now = new Date(),
): CompensationPhase {
  if (contributor.cashEligibleOverride === true) return 'cash';
  if (!contributor.activatedAt) return 'cash';
  return monthsBetween(contributor.activatedAt, now) < COMPENSATION_CASH_MONTHS
    ? 'cash'
    : 'reciprocity';
}

/** Months remaining in a furnisher's cash year, or 0 once it has elapsed. */
export function cashMonthsRemaining(
  contributor: Pick<DataContributor, 'activatedAt' | 'cashEligibleOverride'>,
  now = new Date(),
): number {
  if (contributor.cashEligibleOverride === true) return Infinity;
  if (!contributor.activatedAt) return COMPENSATION_CASH_MONTHS;
  const elapsed = monthsBetween(contributor.activatedAt, now);
  return Math.max(0, COMPENSATION_CASH_MONTHS - elapsed);
}

// ── Attribution ───────────────────────────────────────────────────────────────

/**
 * How much each furnished event type counts toward the split.
 *
 * These are the published Mode 1 factor weights, mapped onto the event types
 * that actually inform each factor — "apportioned by contribution" made
 * specific. Splitting by raw event count instead would pay for volume rather
 * than relevance: the x402 micropayment stream furnishes 68% of all events, but
 * a per-call payment tells a lender far less about repayment risk than a single
 * settled facility outcome does.
 *
 * Two factors are deliberately absent, and their weight is not redistributed
 * silently — the shares below simply normalise over what remains:
 *
 *   Age of credit (15%)  — a property of the file's oldest event, not of any
 *                          one furnisher's contribution.
 *   Credit mix (10%)     — a property of the portfolio as a whole.
 *
 * Known tension, recorded rather than papered over: identity attestations and
 * sanctions results inform no scored Mode 1 factor, so under a
 * weighted-by-scoring-impact rule they earn nothing. That is consistent, and it
 * is also a weak incentive to furnish exactly the data the dispute rail and
 * regulatory posture depend on. Revisit once Mode 2 attribution exists.
 */
const EVENT_WEIGHT: Record<CreditEventType, number> = {
  // Payment history — 35%, the heaviest factor in the model.
  payment_on_time:   35,
  payment_late_30:   35,
  payment_late_60:   35,
  payment_late_90:   35,
  default:           35,

  // Credit utilisation — 30%. Opening and closing lines moves the denominator.
  credit_opened:     30,
  credit_closed:     30,

  // New credit and velocity — 10%.
  hard_inquiry:      10,

  // Not scored Mode 1 factors — see the note above.
  identity_verified: 0,
  sanctions_hit:     0,

  // Bureau-generated, never furnished evidence.
  score_updated:     0,
  dispute_filed:     0,
  dispute_resolved:  0,
};

export interface AttributedShare {
  contributorId: string;
  /** Fraction of the furnisher pool, 0–1. */
  share: number;
}

/**
 * Split one inquiry's furnisher pool across the contributors whose events
 * informed the score.
 *
 * Events with no `contributorId` are pre-attribution records — furnished before
 * provenance was tracked, or seeded — and are excluded rather than assigned to
 * anyone. Excluding them shrinks the pool's base but never misattributes it.
 */
export function attributeInquiry(creditHistory: CreditEvent[]): AttributedShare[] {
  const weightByContributor = new Map<string, number>();
  let totalWeight = 0;

  for (const event of creditHistory) {
    if (!event.contributorId) continue;
    const weight = EVENT_WEIGHT[event.eventType] ?? 0;
    if (weight === 0) continue;
    weightByContributor.set(
      event.contributorId,
      (weightByContributor.get(event.contributorId) ?? 0) + weight,
    );
    totalWeight += weight;
  }

  if (totalWeight === 0) return [];

  return [...weightByContributor.entries()]
    .map(([contributorId, weight]) => ({ contributorId, share: weight / totalWeight }))
    .sort((a, b) => b.share - a.share);
}

// ── Recording an inquiry's compensation ───────────────────────────────────────

export interface InquiryCompensation {
  entries: AttributionEntry[];
  totalCashUsdCents: number;
  totalCreditsAccrued: number;
  /** Pool that went unattributed because no scored event carried provenance. */
  unattributedUsdCents: number;
}

const usdToCents = (usd: number): number => Math.round(usd * 100);

/**
 * Compute and record what each furnisher earned from one paid inquiry.
 *
 * Called after a report is generated and its fee settled. Every entry is
 * written individually and tied to the report, so a later dispute can reverse
 * exactly the attribution a disputed event produced — see `reverseAttribution`.
 */
export function compensateInquiry(
  reportId: string,
  agentId: string,
  creditHistory: CreditEvent[],
  now = new Date(),
): InquiryCompensation {
  const poolUsdCents = usdToCents(FURNISHER_SHARE_OF_LIST_USD);
  const shares = attributeInquiry(creditHistory);

  if (shares.length === 0) {
    return { entries: [], totalCashUsdCents: 0, totalCreditsAccrued: 0, unattributedUsdCents: poolUsdCents };
  }

  const entries: AttributionEntry[] = [];
  let totalCash = 0;
  let totalCredits = 0;

  for (const { contributorId, share } of shares) {
    const contributor = getContributor(contributorId);
    // A contributor that has been deleted still had its data used; the share is
    // computed but nothing is credited, and it shows as unattributed.
    if (!contributor) continue;

    const phase = compensationPhase(contributor, now);
    const shareUsdCents = Math.round(poolUsdCents * share);

    let amountUsdCents = 0;
    let creditsAccrued = 0;

    if (phase === 'cash') {
      amountUsdCents = shareUsdCents;
      totalCash += amountUsdCents;
    } else {
      // Credits are denominated at list value, then upflifted. A $0.70 share
      // becomes 0.25 credits at list, ×2 = 0.5 credits.
      creditsAccrued = (shareUsdCents / 100 / LIST_INQUIRY_USD) * RECIPROCITY_MULTIPLIER;
      totalCredits += creditsAccrued;
      accrueCredits(contributorId, creditsAccrued, now);
    }

    const entry: AttributionEntry = {
      id: randomUUID(),
      contributorId,
      reportId,
      agentId,
      share,
      amountUsdCents,
      creditsAccrued,
      phase,
      createdAt: now.toISOString(),
    };
    recordAttribution(entry);
    entries.push(entry);
  }

  const attributedCents = entries.reduce((sum, e) => sum + e.amountUsdCents, 0);
  const creditedAsCash = entries.filter(e => e.phase === 'cash');
  const unattributed = creditedAsCash.length > 0
    ? Math.max(0, poolUsdCents - attributedCents - creditsSideOfPool(entries, poolUsdCents))
    : 0;

  return {
    entries,
    totalCashUsdCents: totalCash,
    totalCreditsAccrued: totalCredits,
    unattributedUsdCents: unattributed,
  };
}

/** The notional cents represented by the credit-phase entries in this inquiry. */
function creditsSideOfPool(entries: AttributionEntry[], poolUsdCents: number): number {
  const creditShare = entries
    .filter(e => e.phase === 'reciprocity')
    .reduce((sum, e) => sum + e.share, 0);
  return Math.round(poolUsdCents * creditShare);
}

// ── Credits ledger ────────────────────────────────────────────────────────────

function emptyBalance(contributorId: string, now: Date): CreditBalance {
  return {
    contributorId,
    creditsAvailable: 0,
    creditsRedeemed: 0,
    creditsExpired: 0,
    oldestUnexpiredAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function creditBalanceFor(contributorId: string, now = new Date()): CreditBalance {
  return getCreditBalance(contributorId) ?? emptyBalance(contributorId, now);
}

function accrueCredits(contributorId: string, credits: number, now: Date): CreditBalance {
  const balance = creditBalanceFor(contributorId, now);
  const updated: CreditBalance = {
    ...balance,
    creditsAvailable: balance.creditsAvailable + credits,
    updatedAt: now.toISOString(),
  };
  return setCreditBalance(updated);
}

export type RedeemResult =
  | { ok: true; balance: CreditBalance }
  | { ok: false; reason: 'insufficient_credits'; available: number };

/**
 * Spend one credit on a hard pull.
 *
 * Whole credits only. A furnisher holding 0.5 credits cannot half-buy a report,
 * and rounding up would let fractional accrual mint free inquiries.
 */
export function redeemCredits(contributorId: string, credits = 1, now = new Date()): RedeemResult {
  const balance = creditBalanceFor(contributorId, now);
  if (balance.creditsAvailable < credits) {
    return { ok: false, reason: 'insufficient_credits', available: balance.creditsAvailable };
  }
  const updated: CreditBalance = {
    ...balance,
    creditsAvailable: balance.creditsAvailable - credits,
    creditsRedeemed: balance.creditsRedeemed + credits,
    updatedAt: now.toISOString(),
  };
  return { ok: true, balance: setCreditBalance(updated) };
}

// ── Clawback ──────────────────────────────────────────────────────────────────

export interface ReversalResult {
  reversed: AttributionEntry[];
  cashReversedUsdCents: number;
  creditsReversed: number;
}

/**
 * Reverse every attribution a report produced, when a dispute invalidates the
 * data behind it.
 *
 * The dispute rail already excludes disputed tradelines from future scoring.
 * Without this, it did nothing about revenue a furnisher had already earned
 * from inquiries answered while the bad data was live — upside with no
 * downside, which is precisely the incentive to furnish liberally and argue
 * later.
 *
 * Credits are clawed back only as far as the balance allows: a furnisher that
 * has already redeemed them has consumed real inquiries, and the balance is
 * floored at zero rather than driven negative.
 */
export function reverseAttribution(
  reportId: string,
  reason: string,
  now = new Date(),
): ReversalResult {
  const entries = listAttributionsForReport(reportId).filter(e => !e.reversedAt);
  let cashReversed = 0;
  let creditsReversed = 0;

  for (const entry of entries) {
    const reversed: AttributionEntry = {
      ...entry,
      reversedAt: now.toISOString(),
      reversalReason: reason,
    };
    recordAttribution(reversed);

    cashReversed += entry.amountUsdCents;

    if (entry.creditsAccrued > 0) {
      const balance = creditBalanceFor(entry.contributorId, now);
      const recoverable = Math.min(balance.creditsAvailable, entry.creditsAccrued);
      if (recoverable > 0) {
        setCreditBalance({
          ...balance,
          creditsAvailable: balance.creditsAvailable - recoverable,
          updatedAt: now.toISOString(),
        });
        creditsReversed += recoverable;
      }
    }
  }

  return { reversed: entries, cashReversedUsdCents: cashReversed, creditsReversed };
}

// ── Statement ─────────────────────────────────────────────────────────────────

export interface FurnisherStatement {
  contributorId: string;
  phase: CompensationPhase;
  cashMonthsRemaining: number;
  cashOwedUsdCents: number;
  creditsAvailable: number;
  creditsRedeemed: number;
  inquiriesInformed: number;
}

/**
 * What a furnisher is owed right now.
 *
 * Reversed entries are excluded from both totals — a statement that still
 * counted clawed-back revenue would be the same asymmetry this module exists
 * to close. Entries a settlement already paid (settlementId set) are
 * excluded from cashOwedUsdCents the same way furnisher-payouts.ts's
 * unsettledEntriesFor() excludes them from what a settlement run pays —
 * otherwise this statement would keep reporting cash as owed forever after
 * it was actually sent, which is the exact "promise published, money never
 * moves" problem furnisher-payouts.ts exists to close, just showing up one
 * layer up. inquiriesInformed stays a lifetime count over `mine`: whether an
 * inquiry has been paid for doesn't change whether it happened.
 */
export function furnisherStatement(
  contributorId: string,
  allEntries: AttributionEntry[],
  now = new Date(),
): FurnisherStatement {
  const mine = allEntries.filter(e => e.contributorId === contributorId && !e.reversedAt);
  const unpaid = mine.filter(e => !e.settlementId);
  const contributor = getContributor(contributorId);
  const balance = creditBalanceFor(contributorId, now);

  return {
    contributorId,
    phase: contributor ? compensationPhase(contributor, now) : 'cash',
    cashMonthsRemaining: contributor ? cashMonthsRemaining(contributor, now) : COMPENSATION_CASH_MONTHS,
    cashOwedUsdCents: unpaid.reduce((sum, e) => sum + e.amountUsdCents, 0),
    creditsAvailable: balance.creditsAvailable,
    creditsRedeemed: balance.creditsRedeemed,
    inquiriesInformed: mine.length,
  };
}
