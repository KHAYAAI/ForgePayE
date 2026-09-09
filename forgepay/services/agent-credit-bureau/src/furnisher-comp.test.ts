/**
 * Furnisher compensation: the cash year, the switch to reciprocity, weighted
 * attribution, and clawback.
 *
 * The assertions that matter most here are the ones about what must *not*
 * happen: a furnisher must not keep earning cash forever, must not be paid for
 * volume rather than relevance, and must not keep revenue earned on data a
 * dispute later invalidated.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  compensationPhase, cashMonthsRemaining, attributeInquiry, compensateInquiry,
  redeemCredits, reverseAttribution, creditBalanceFor, furnisherStatement,
  COMPENSATION_CASH_MONTHS, RECIPROCITY_MULTIPLIER,
} from './furnisher-comp';
import { FURNISHER_SHARE_OF_LIST_USD, LIST_INQUIRY_USD } from './plans';
import {
  setContributor, contributors, attributions, creditBalances,
  listAttributionsForContributor,
} from './store';
import type { CreditEvent, CreditEventType, DataContributor } from './types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-09T00:00:00Z');
const monthsAgo = (n: number) => new Date(NOW.getTime() - n * MONTH_MS).toISOString();

function contributor(id: string, over: Partial<DataContributor> = {}): DataContributor {
  return setContributor({
    id,
    name: id,
    type: 'lender',
    apiKeyHash: 'x'.repeat(64),
    permissions: ['ingest_events'],
    queriesUsed: 0,
    queriesAllowed: 1000,
    dataRecordsContributed: 0,
    createdAt: monthsAgo(24),
    status: 'active',
    ...over,
  } as DataContributor);
}

let seq = 0;
function event(contributorId: string | undefined, eventType: CreditEventType): CreditEvent {
  seq += 1;
  return {
    id: 'evt_' + seq,
    agentId: 'agent_test',
    eventType,
    description: eventType,
    timestamp: monthsAgo(1),
    ...(contributorId ? { contributorId } : {}),
  };
}

beforeEach(() => {
  attributions.clear();
  creditBalances.clear();
  // Leave seeded contributors in place; tests use their own ids.
});

// ── Phase ─────────────────────────────────────────────────────────────────────

describe('compensationPhase — the cash year and the switch', () => {
  it('pays cash inside the first twelve months', () => {
    const c = contributor('cp_new', { activatedAt: monthsAgo(3) });
    expect(compensationPhase(c, NOW)).toBe('cash');
  });

  it('switches to reciprocity after twelve months', () => {
    const c = contributor('cp_old', { activatedAt: monthsAgo(13) });
    expect(compensationPhase(c, NOW)).toBe('reciprocity');
  });

  it('treats the boundary month as still-cash, not already-reciprocity', () => {
    const c = contributor('cp_edge', { activatedAt: monthsAgo(COMPENSATION_CASH_MONTHS - 0.1) });
    expect(compensationPhase(c, NOW)).toBe('cash');
  });

  it('defaults an unactivated contributor to cash rather than silently to reciprocity', () => {
    // A missing activation date is a data gap, not evidence the cash year
    // elapsed. The failure mode should favour the furnisher.
    const c = contributor('cp_unactivated', { activatedAt: undefined });
    expect(compensationPhase(c, NOW)).toBe('cash');
  });

  it('honours an explicit admin override for furnishers who cannot spend credits', () => {
    // x402 furnishes the highest-frequency signal on the network and has no use
    // for a credit report. Forcing credits on it would end its participation.
    const c = contributor('cp_rail', { activatedAt: monthsAgo(36), cashEligibleOverride: true });
    expect(compensationPhase(c, NOW)).toBe('cash');
    expect(cashMonthsRemaining(c, NOW)).toBe(Infinity);
  });

  it('counts down the remaining cash months', () => {
    const c = contributor('cp_count', { activatedAt: monthsAgo(9) });
    const remaining = cashMonthsRemaining(c, NOW);
    expect(remaining).toBeGreaterThan(2.5);
    expect(remaining).toBeLessThan(3.5);
  });
});

// ── Attribution ───────────────────────────────────────────────────────────────

describe('attributeInquiry — weighted by scoring impact, not event count', () => {
  it('pays relevance over volume', () => {
    // The core of the rule. A payment-history event carries 35; a hard inquiry
    // carries 10. Ten inquiries should not outweigh five repayment outcomes.
    const history = [
      ...Array.from({ length: 5 },  () => event('lender', 'payment_on_time')),   // 5 × 35 = 175
      ...Array.from({ length: 10 }, () => event('rail',   'hard_inquiry')),      // 10 × 10 = 100
    ];
    const shares = attributeInquiry(history);
    const lender = shares.find(s => s.contributorId === 'lender')!;
    const rail   = shares.find(s => s.contributorId === 'rail')!;

    expect(lender.share).toBeGreaterThan(rail.share);
    expect(lender.share).toBeCloseTo(175 / 275, 5);
    expect(rail.share).toBeCloseTo(100 / 275, 5);
  });

  it('would have inverted under a naive split-by-count rule', () => {
    // Same fixture, stated as the contrast: by raw count the rail furnished
    // twice as many events and would have taken twice the pool.
    const history = [
      ...Array.from({ length: 5 },  () => event('lender', 'payment_on_time')),
      ...Array.from({ length: 10 }, () => event('rail',   'hard_inquiry')),
    ];
    const byCount = { lender: 5 / 15, rail: 10 / 15 };
    const weighted = attributeInquiry(history);

    expect(byCount.rail).toBeGreaterThan(byCount.lender);
    expect(weighted.find(s => s.contributorId === 'rail')!.share)
      .toBeLessThan(byCount.rail);
  });

  it('excludes events with no provenance rather than guessing an owner', () => {
    const history = [
      event('lender', 'payment_on_time'),
      event(undefined, 'payment_on_time'),   // pre-attribution / seeded
    ];
    const shares = attributeInquiry(history);
    expect(shares).toHaveLength(1);
    expect(shares[0].contributorId).toBe('lender');
    expect(shares[0].share).toBe(1);
  });

  it('pays nothing for event types that inform no scored factor', () => {
    const shares = attributeInquiry([
      event('idp', 'identity_verified'),
      event('idp', 'sanctions_hit'),
      event('idp', 'score_updated'),
    ]);
    expect(shares).toEqual([]);
  });

  it('returns an empty split rather than dividing by zero on an empty file', () => {
    expect(attributeInquiry([])).toEqual([]);
  });
});

// ── Paying an inquiry ─────────────────────────────────────────────────────────

describe('compensateInquiry', () => {
  it('pays cash, and no credits, during the cash year', () => {
    contributor('c_cash', { activatedAt: monthsAgo(2) });
    const result = compensateInquiry('rep_1', 'agent_test', [event('c_cash', 'payment_on_time')], NOW);

    expect(result.entries).toHaveLength(1);
    const entry = result.entries[0];
    expect(entry.phase).toBe('cash');
    expect(entry.creditsAccrued).toBe(0);
    // Sole contributor takes the whole pool: 25% of $2.80 = $0.70 = 70 cents.
    expect(entry.amountUsdCents).toBe(Math.round(FURNISHER_SHARE_OF_LIST_USD * 100));
    expect(result.totalCashUsdCents).toBe(70);
  });

  it('accrues credits, and no cash, after the switch', () => {
    contributor('c_recip', { activatedAt: monthsAgo(18) });
    const result = compensateInquiry('rep_2', 'agent_test', [event('c_recip', 'payment_on_time')], NOW);

    const entry = result.entries[0];
    expect(entry.phase).toBe('reciprocity');
    expect(entry.amountUsdCents).toBe(0);
    expect(result.totalCashUsdCents).toBe(0);

    // $0.70 of entitlement ÷ $2.80 list = 0.25 credits, × the multiplier.
    const expected = (0.70 / LIST_INQUIRY_USD) * RECIPROCITY_MULTIPLIER;
    expect(entry.creditsAccrued).toBeCloseTo(expected, 5);
    expect(creditBalanceFor('c_recip', NOW).creditsAvailable).toBeCloseTo(expected, 5);
  });

  it('gives a reciprocity furnisher more nominal value than the cash it replaced', () => {
    // The reason month thirteen is not a pay cut.
    contributor('c_value', { activatedAt: monthsAgo(18) });
    const result = compensateInquiry('rep_3', 'agent_test', [event('c_value', 'payment_on_time')], NOW);
    const nominalUsd = result.entries[0].creditsAccrued * LIST_INQUIRY_USD;
    expect(nominalUsd).toBeGreaterThan(FURNISHER_SHARE_OF_LIST_USD);
  });

  it('splits one pool across several furnishers without exceeding it', () => {
    contributor('c_a', { activatedAt: monthsAgo(1) });
    contributor('c_b', { activatedAt: monthsAgo(1) });
    const result = compensateInquiry('rep_4', 'agent_test', [
      event('c_a', 'payment_on_time'),
      event('c_b', 'credit_opened'),
    ], NOW);

    expect(result.entries).toHaveLength(2);
    // Rounding may lose a cent; it must never invent one.
    expect(result.totalCashUsdCents).toBeLessThanOrEqual(70);
    const shareSum = result.entries.reduce((s, e) => s + e.share, 0);
    expect(shareSum).toBeCloseTo(1, 5);
  });

  it('reports the pool as unattributed when no scored event carries provenance', () => {
    const result = compensateInquiry('rep_5', 'agent_test', [event(undefined, 'payment_on_time')], NOW);
    expect(result.entries).toEqual([]);
    expect(result.unattributedUsdCents).toBe(70);
  });
});

// ── Credits ───────────────────────────────────────────────────────────────────

describe('redeemCredits', () => {
  it('refuses a redemption the balance cannot cover', () => {
    contributor('c_broke', { activatedAt: monthsAgo(18) });
    const result = redeemCredits('c_broke', 1, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('insufficient_credits');
  });

  it('decrements available and increments redeemed', () => {
    contributor('c_rich', { activatedAt: monthsAgo(18) });
    // Four inquiries at 0.5 credits each = 2 credits.
    for (let i = 0; i < 4; i++) {
      compensateInquiry('rep_r' + i, 'agent_test', [event('c_rich', 'payment_on_time')], NOW);
    }
    const before = creditBalanceFor('c_rich', NOW).creditsAvailable;
    expect(before).toBeCloseTo(2, 5);

    const result = redeemCredits('c_rich', 1, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.balance.creditsAvailable).toBeCloseTo(1, 5);
    expect(result.balance.creditsRedeemed).toBe(1);
  });
});

// ── Clawback ──────────────────────────────────────────────────────────────────

describe('reverseAttribution — the dispute clawback', () => {
  it('reverses cash earned on data a dispute invalidated', () => {
    contributor('c_bad', { activatedAt: monthsAgo(1) });
    compensateInquiry('rep_bad', 'agent_test', [event('c_bad', 'payment_on_time')], NOW);

    const statementBefore = furnisherStatement('c_bad', listAttributionsForContributor('c_bad'), NOW);
    expect(statementBefore.cashOwedUsdCents).toBe(70);

    const reversal = reverseAttribution('rep_bad', 'dispute upheld: event fabricated', NOW);
    expect(reversal.cashReversedUsdCents).toBe(70);

    const statementAfter = furnisherStatement('c_bad', listAttributionsForContributor('c_bad'), NOW);
    expect(statementAfter.cashOwedUsdCents).toBe(0);
  });

  it('claws back credits, but never below zero once they have been spent', () => {
    contributor('c_spent', { activatedAt: monthsAgo(18) });
    compensateInquiry('rep_spent', 'agent_test', [event('c_spent', 'payment_on_time')], NOW);
    // Accrued 0.5; spend nothing recoverable by redeeming what exists is not
    // possible at <1 credit, so drain the balance directly via a second accrual
    // then a redemption.
    compensateInquiry('rep_spent2', 'agent_test', [event('c_spent', 'payment_on_time')], NOW);
    redeemCredits('c_spent', 1, NOW);
    expect(creditBalanceFor('c_spent', NOW).creditsAvailable).toBeCloseTo(0, 5);

    const reversal = reverseAttribution('rep_spent', 'dispute upheld', NOW);
    // Nothing left to reclaim — the furnisher already consumed real inquiries.
    expect(reversal.creditsReversed).toBe(0);
    expect(creditBalanceFor('c_spent', NOW).creditsAvailable).toBeGreaterThanOrEqual(0);
  });

  it('leaves a record rather than deleting the entry', () => {
    contributor('c_record', { activatedAt: monthsAgo(1) });
    compensateInquiry('rep_record', 'agent_test', [event('c_record', 'payment_on_time')], NOW);
    reverseAttribution('rep_record', 'dispute upheld', NOW);

    const entries = listAttributionsForContributor('c_record');
    expect(entries).toHaveLength(1);
    expect(entries[0].reversedAt).toBeTruthy();
    expect(entries[0].reversalReason).toBe('dispute upheld');
  });

  it('is idempotent — a second reversal reverses nothing further', () => {
    contributor('c_twice', { activatedAt: monthsAgo(1) });
    compensateInquiry('rep_twice', 'agent_test', [event('c_twice', 'payment_on_time')], NOW);

    const first  = reverseAttribution('rep_twice', 'dispute upheld', NOW);
    const second = reverseAttribution('rep_twice', 'dispute upheld again', NOW);

    expect(first.cashReversedUsdCents).toBe(70);
    expect(second.cashReversedUsdCents).toBe(0);
    expect(second.reversed).toHaveLength(0);
  });
});
