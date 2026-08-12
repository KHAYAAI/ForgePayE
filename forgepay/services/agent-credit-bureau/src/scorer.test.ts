/**
 * Tests for the scoring engine — the core IP, previously untested.
 *
 * The headline test is `stored score always equals a live recompute`: the
 * regression that motivated this file was `/score` serving a stored
 * `currentScore` while `/dual-score` recomputed, so the same agent could be
 * reported at two different scores (observed spread: up to 102 points, wide
 * enough to cross a grade boundary and flip a lending decision).
 *
 * Age-of-credit is computed against `Date.now()`, so fixtures with fixed
 * `createdAt` values drift upward in real time. Assertions here therefore
 * target bands, orderings and invariants rather than frozen integers —
 * except where a component is genuinely time-independent.
 */
import { describe, expect, it } from 'vitest';
import {
  computeScore, scoreTier, maxRecommendedLimit, computeMode2Score, computeDualModeScore,
  computePaymentHistoryRate,
} from './scorer';
import { profiles } from './store';
import type { AgentCreditProfile, Mode2Inputs } from './types';

/** A well-established, well-behaved baseline: old account, low use, all paid. */
function baseProfile(over: Partial<AgentCreditProfile> = {}): Partial<AgentCreditProfile> {
  return {
    agentId: 'agent_test',
    paymentHistoryRate: 1.0,
    utilizationRate: 0.10,
    delinquencies: [],
    hardInquiries: [],
    creditHistory: [
      { id: 'e1', agentId: 'agent_test', eventType: 'credit_opened', amount: 1000, creditorId: 'c', description: '', timestamp: '2020-01-01T00:00:00Z' },
      { id: 'e2', agentId: 'agent_test', eventType: 'payment_on_time', amount: 100, creditorId: 'c', description: '', timestamp: '2020-02-01T00:00:00Z' },
    ],
    createdAt: '2020-01-01T00:00:00Z',
    ...over,
  } as Partial<AgentCreditProfile>;
}

describe('computeScore — invariants', () => {
  it('never leaves the published 300–1000 range, even for a worst case', () => {
    const worst = computeScore(baseProfile({
      paymentHistoryRate: 0,
      utilizationRate: 1.0,
      delinquencies: [
        { id: 'd1', creditorId: 'c', amount: 1, daysLate: 90, openedAt: '2024-01-01T00:00:00Z', status: 'open' },
        { id: 'd2', creditorId: 'c', amount: 1, daysLate: 90, openedAt: '2024-01-01T00:00:00Z', status: 'open' },
      ],
      creditHistory: [
        { id: 'e', agentId: 'a', eventType: 'default', amount: 1, creditorId: 'c', description: '', timestamp: '2024-01-01T00:00:00Z' },
      ],
      createdAt: new Date().toISOString(),
    } as Partial<AgentCreditProfile>));
    expect(worst.score).toBeGreaterThanOrEqual(300);
    expect(worst.score).toBeLessThanOrEqual(1000);
  });

  it('caps a perfect profile at 1000', () => {
    const best = computeScore(baseProfile({
      creditHistory: [
        { id: 'e1', agentId: 'a', eventType: 'credit_opened', amount: 1, creditorId: 'c', description: '', timestamp: '2020-01-01T00:00:00Z' },
        { id: 'e2', agentId: 'a', eventType: 'payment_on_time', amount: 1, creditorId: 'c', description: '', timestamp: '2020-02-01T00:00:00Z' },
        { id: 'e3', agentId: 'a', eventType: 'hard_inquiry', creditorId: 'c', description: '', timestamp: '2020-03-01T00:00:00Z' },
      ],
    } as Partial<AgentCreditProfile>));
    expect(best.score).toBeLessThanOrEqual(1000);
    expect(best.score).toBeGreaterThan(900);
  });

  it('is deterministic — same input, same score', () => {
    const p = baseProfile();
    expect(computeScore(p).score).toBe(computeScore(p).score);
  });

  it('returns at most four factors, ordered by weight descending', () => {
    const { factors } = computeScore(baseProfile());
    expect(factors.length).toBeLessThanOrEqual(4);
    const weights = factors.map(f => f.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });
});

describe('computeScore — component behaviour', () => {
  it('penalises late payments', () => {
    const good = computeScore(baseProfile({ paymentHistoryRate: 1.0 })).score;
    const bad  = computeScore(baseProfile({ paymentHistoryRate: 0.5 })).score;
    expect(bad).toBeLessThan(good);
  });

  it('penalises utilisation monotonically across every published band', () => {
    const bands = [0.05, 0.25, 0.45, 0.65, 0.85, 0.95];
    const scores = bands.map(u => computeScore(baseProfile({ utilizationRate: u })).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]!);
    }
    expect(scores[scores.length - 1]!).toBeLessThan(scores[0]!);
  });

  it('rewards a longer credit history', () => {
    const iso = (monthsAgo: number) =>
      new Date(Date.now() - monthsAgo * 30.44 * 24 * 3600 * 1000).toISOString();
    const young = computeScore(baseProfile({ createdAt: iso(1) })).score;
    const old   = computeScore(baseProfile({ createdAt: iso(36) })).score;
    expect(old).toBeGreaterThan(young);
  });

  it('penalises each additional open delinquency', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: `d${i}`, creditorId: 'c', amount: 100, daysLate: 30,
      openedAt: '2024-01-01T00:00:00Z', status: 'open' as const,
    }));
    const none = computeScore(baseProfile({ delinquencies: mk(0) })).score;
    const one  = computeScore(baseProfile({ delinquencies: mk(1) })).score;
    const two  = computeScore(baseProfile({ delinquencies: mk(2) })).score;
    expect(one).toBeLessThan(none);
    expect(two).toBeLessThan(one);
  });

  it('penalises a default hard, and flags it', () => {
    const clean = computeScore(baseProfile()).score;
    const { score, factors } = computeScore(baseProfile({
      creditHistory: [
        { id: 'e', agentId: 'a', eventType: 'default', amount: 500, creditorId: 'c', description: '', timestamp: '2024-06-01T00:00:00Z' },
      ],
    } as Partial<AgentCreditProfile>));
    expect(score).toBeLessThan(clean);
    expect(factors.some(f => f.code === 'RECENT_DEFAULT')).toBe(true);
  });

  it('penalises each additional default — was a flat penalty regardless of count', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: `def${i}`, agentId: 'a', eventType: 'default' as const, amount: 500,
      creditorId: 'c', description: '', timestamp: '2024-06-01T00:00:00Z',
    }));
    const one   = computeScore(baseProfile({ creditHistory: mk(1) })).score;
    const three = computeScore(baseProfile({ creditHistory: mk(3) })).score;
    expect(three).toBeLessThan(one);
  });

  it('names the default count in the factor description', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: `def${i}`, agentId: 'a', eventType: 'default' as const, amount: 500,
      creditorId: 'c', description: '', timestamp: '2024-06-01T00:00:00Z',
    }));
    const single = computeScore(baseProfile({ creditHistory: mk(1) })).factors
      .find(f => f.code === 'RECENT_DEFAULT');
    const multiple = computeScore(baseProfile({ creditHistory: mk(4) })).factors
      .find(f => f.code === 'RECENT_DEFAULT');
    expect(single?.description).toContain('1 account');
    expect(multiple?.description).toContain('4 accounts');
  });

  it('penalises inquiry velocity only for inquiries inside the 30-day window', () => {
    const recent = (n: number) => Array.from({ length: n }, (_, i) => ({
      id: `i${i}`, requestorId: 'r', requestorName: 'R',
      purpose: 'credit_application' as const,
      timestamp: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    }));
    const stale = [{
      id: 'old', requestorId: 'r', requestorName: 'R',
      purpose: 'credit_application' as const,
      timestamp: '2020-01-01T00:00:00Z',
    }];
    const none      = computeScore(baseProfile({ hardInquiries: [] })).score;
    const staleOnly = computeScore(baseProfile({ hardInquiries: stale } as Partial<AgentCreditProfile>)).score;
    const threeNew  = computeScore(baseProfile({ hardInquiries: recent(3) } as Partial<AgentCreditProfile>)).score;

    expect(staleOnly).toBe(none);          // outside the window — no penalty
    expect(threeNew).toBeLessThan(none);   // inside the window — penalised
  });
});

describe('computePaymentHistoryRate', () => {
  const ev = (eventType: string) =>
    ({ id: `e_${Math.random()}`, agentId: 'a', eventType, creditorId: 'c', description: '', timestamp: '2024-01-01T00:00:00Z' }) as never;

  it('counts a default as a fully failed obligation, not an absence', () => {
    // Regression: a `default` doesn't start with "payment", so the old
    // `eventType.startsWith('payment')` denominator excluded it entirely —
    // an agent with six defaults and zero recorded late payments computed a
    // perfect 1.0 rate, because there was nothing in the denominator at all.
    const sixDefaults = Array.from({ length: 6 }, () => ev('default'));
    expect(computePaymentHistoryRate(sixDefaults)).toBe(0);
  });

  it('mixes on-time, late, and default correctly', () => {
    const history = [ev('payment_on_time'), ev('payment_on_time'), ev('payment_late_30'), ev('default')];
    expect(computePaymentHistoryRate(history)).toBe(0.5); // 2 of 4 obligations honoured on time
  });

  it('defaults to a clean 1.0 with no payment obligations on file', () => {
    expect(computePaymentHistoryRate([])).toBe(1);
    expect(computePaymentHistoryRate([ev('credit_opened'), ev('hard_inquiry')])).toBe(1);
  });

  it('ignores non-payment event types in both numerator and denominator', () => {
    const history = [ev('payment_on_time'), ev('credit_opened'), ev('identity_verified'), ev('sanctions_hit')];
    expect(computePaymentHistoryRate(history)).toBe(1);
  });
});

describe('scoreTier / maxRecommendedLimit', () => {
  it('maps scores to the published tier bands', () => {
    expect(scoreTier(850)).toBe('SUPER_PRIME');
    expect(scoreTier(700)).toBe('PRIME');
    expect(scoreTier(600)).toBe('NEAR_PRIME');
    expect(scoreTier(520)).toBe('SUBPRIME');
    expect(scoreTier(400)).toBe('DEEP_SUBPRIME');
  });

  it('never recommends a larger limit for a worse score', () => {
    const pts = [1000, 900, 800, 700, 600, 500, 400, 300];
    const lims = pts.map(maxRecommendedLimit);
    for (let i = 1; i < lims.length; i++) {
      expect(lims[i]).toBeLessThanOrEqual(lims[i - 1]!);
    }
  });
});

// ── The regression this suite exists for ─────────────────────────────────────

describe('score consistency — stored vs recomputed', () => {
  it('every seeded profile stores exactly what a live recompute returns', () => {
    expect(profiles.size).toBeGreaterThan(0);
    for (const p of profiles.values()) {
      const { score } = computeScore(p);
      expect(
        p.currentScore,
        `${p.agentId}: stored ${p.currentScore} but recompute gives ${score}`,
      ).toBe(score);
    }
  });

  it('stored tier agrees with the stored score', () => {
    for (const p of profiles.values()) {
      expect(p.tier, `${p.agentId} tier disagrees with score ${p.currentScore}`)
        .toBe(scoreTier(p.currentScore));
    }
  });

  it('dual-score Mode 1 matches the profile the bureau publishes', () => {
    for (const p of profiles.values()) {
      const dual = computeDualModeScore(p.agentId, p, null);
      expect(
        dual.mode1.score,
        `${p.agentId}: /score would return ${p.currentScore}, /dual-score ${dual.mode1.score}`,
      ).toBe(p.currentScore);
    }
  });
});

describe('seeded fixtures cover the tier ladder', () => {
  it('spans super-prime through deep-subprime with no tier collision', () => {
    const byTier = new Map<string, string[]>();
    for (const p of profiles.values()) {
      byTier.set(p.tier, [...(byTier.get(p.tier) ?? []), p.agentId]);
    }
    expect(byTier.has('SUPER_PRIME')).toBe(true);
    expect(byTier.has('PRIME')).toBe(true);
    expect(byTier.has('SUBPRIME')).toBe(true);
    expect(byTier.has('DEEP_SUBPRIME')).toBe(true);
  });

  it('ranks the enterprise agent above the merely prime one', () => {
    const sup = profiles.get('agent_super_001')!;
    const pri = profiles.get('agent_prime_001')!;
    expect(sup.currentScore).toBeGreaterThan(pri.currentScore);
  });
});

// ── Mode 2 / consensus ───────────────────────────────────────────────────────

describe('computeMode2Score + consensus classification', () => {
  // No `as` cast here on purpose: the field names must be checked by the
  // compiler. An earlier draft of this helper used plausible-but-wrong names
  // (`successRate`, `transactionCount`, `budgetCompliance`) and the cast
  // silenced it — the suite then failed at runtime inside computeMode2Score.
  const m2 = (over: Partial<Mode2Inputs> = {}): Mode2Inputs => ({
    successRateBps: 9_500,        // basis points → 95%
    totalVolumeUsd: 500_000,
    totalCount: 4_000,
    budgetComplianceRate: 0.98,
    accountAgeMonths: 30,
    onChainSettled: true,
    ...over,
  });

  it('stays inside 300–1000', () => {
    expect(computeMode2Score(m2()).score).toBeGreaterThanOrEqual(300);
    expect(computeMode2Score(m2()).score).toBeLessThanOrEqual(1000);
    const weak = computeMode2Score(m2({ successRateBps: 0, totalVolumeUsd: 0, totalCount: 0, budgetComplianceRate: 0, accountAgeMonths: 0 }));
    expect(weak.score).toBeGreaterThanOrEqual(300);
  });

  it('rewards a higher success rate', () => {
    expect(computeMode2Score(m2({ successRateBps: 9_900 })).score)
      .toBeGreaterThan(computeMode2Score(m2({ successRateBps: 6_000 })).score);
  });

  it('reports MEDIUM consensus and defers to Mode 1 when no on-chain score exists', () => {
    const p = profiles.get('agent_prime_001')!;
    const d = computeDualModeScore(p.agentId, p, null);
    expect(d.mode2).toBeNull();
    expect(d.consensus.level).toBe('MEDIUM');
    expect(d.consensus.authoritative).toBe('MODE_1');
    expect(d.consensus.flagForReview).toBe(false);
  });

  it('classifies variance against the published thresholds and reports it honestly', () => {
    const p = profiles.get('agent_prime_001')!;
    const d = computeDualModeScore(p.agentId, p, m2());
    expect(d.mode2).not.toBeNull();
    expect(d.consensus.variance).toBe(Math.abs(d.mode1.score - d.mode2!.score));

    const v = d.consensus.variance;
    const expected = v <= 50 ? 'HIGH' : v <= 100 ? 'MEDIUM' : 'LOW';
    expect(d.consensus.level).toBe(expected);
    expect(d.consensus.flagForReview).toBe(v > 50);
  });
});
