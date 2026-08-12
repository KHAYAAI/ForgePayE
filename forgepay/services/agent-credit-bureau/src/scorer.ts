/**
 * ForgePay Agent Credit Bureau — Scoring Engine
 * ──────────────────────────────────────────────
 * Deterministic, explainable credit scoring (0-1000 scale).
 *
 * Component weights:
 *   Payment History      35% — % on-time, delinquencies, defaults
 *   Credit Utilization   30% — total debt / total limit
 *   Age of Credit        15% — months since first credit event
 *   Credit Mix           10% — diversity of event types
 *   New Credit / Velocity 10% — hard inquiries in last 30 days
 */

import type {
  AgentCreditProfile, CreditEvent, CreditTier, ScoreFactor,
  Mode1Score, Mode2Score, Mode2Inputs, DualModeScore, ConsensusLevel,
} from './types';

/**
 * Fraction of payment obligations paid on time.
 *
 * A `default` is a fully failed obligation — worse than late, never repaid —
 * so it belongs in the denominator alongside on-time and late payments, not
 * left out of the calculation entirely. Every caller that mutates
 * `creditHistory` (event ingest, furnisher ingest, dispute resolution) must
 * recompute `paymentHistoryRate` through this function rather than inline,
 * the same "one function owns this" rule `deriveScoreFields` applies to the
 * score itself.
 *
 * Deliberately NOT called from inside `computeScore`: `paymentHistoryRate` is
 * a stored field the caller supplies, verified independently by
 * `scorer.test.ts` fixtures that set it to values a live recompute over their
 * own `creditHistory` would not reproduce. Folding this in there would make
 * `computeScore` silently override an input several tests deliberately choose
 * by hand.
 */
export function computePaymentHistoryRate(history: CreditEvent[]): number {
  const onTime = history.filter(e => e.eventType === 'payment_on_time').length;
  const obligations = history.filter(e =>
    e.eventType === 'payment_on_time' ||
    e.eventType === 'payment_late_30' ||
    e.eventType === 'payment_late_60' ||
    e.eventType === 'payment_late_90' ||
    e.eventType === 'default',
  ).length;
  return obligations > 0 ? onTime / obligations : 1;
}

// ── Tier thresholds ───────────────────────────────────────────────────────────

export function scoreTier(score: number): CreditTier {
  if (score >= 800) return 'SUPER_PRIME';
  if (score >= 670) return 'PRIME';
  if (score >= 580) return 'NEAR_PRIME';
  if (score >= 500) return 'SUBPRIME';
  return 'DEEP_SUBPRIME';
}

function riskGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 800) return 'A';
  if (score >= 670) return 'B';
  if (score >= 580) return 'C';
  if (score >= 500) return 'D';
  return 'F';
}

export function maxRecommendedLimit(score: number): number {
  if (score >= 900) return 100_000;
  if (score >= 800) return 50_000;
  if (score >= 700) return 20_000;
  if (score >= 620) return 5_000;
  if (score >= 580) return 2_000;
  if (score >= 500) return 500;
  return 0;
}

export function scoreRecommendation(score: number) {
  if (score >= 700) return 'approve' as const;
  if (score >= 620) return 'approve_with_conditions' as const;
  if (score >= 500) return 'manual_review' as const;
  return 'decline' as const;
}

// ── Main scoring function ─────────────────────────────────────────────────────

export function computeScore(profile: Partial<AgentCreditProfile>): {
  score: number;
  factors: ScoreFactor[];
} {
  const factors: ScoreFactor[] = [];

  // ── 1. Payment History (35%) ─────────────────────────────────────────────
  const payRate    = profile.paymentHistoryRate ?? 1.0;
  const delinqCount = (profile.delinquencies ?? []).filter(d => d.status === 'open').length;
  // Was a boolean: a single default and ten defaults both subtracted the same
  // flat 120, so an agent could rack up repeat defaults for free once the
  // first one landed. Scaled per default, matching the per-delinquency
  // pattern immediately above it.
  const defaultCount = (profile.creditHistory ?? []).filter(e => e.eventType === 'default').length;
  const hasDefault  = defaultCount > 0;

  let payScore = payRate * 350;
  if (delinqCount > 0)  payScore -= delinqCount * 40;
  if (defaultCount > 0) payScore -= defaultCount * 120;
  payScore = Math.max(0, Math.min(350, payScore));

  if (payRate < 0.8 || hasDefault) {
    factors.push({
      code: hasDefault ? 'RECENT_DEFAULT' : 'LATE_PAYMENTS',
      description: hasDefault
        ? `${defaultCount} account${defaultCount === 1 ? '' : 's'} in default severely impact${defaultCount === 1 ? 's' : ''} the score.`
        : `Payment history shows ${Math.round((1 - payRate) * 100)}% late payments.`,
      impact: 'negative',
      weight: 35,
    });
  } else {
    factors.push({
      code: 'STRONG_PAYMENT_HISTORY',
      description: `${Math.round(payRate * 100)}% of payments made on time.`,
      impact: 'positive',
      weight: 35,
    });
  }

  // ── 2. Credit Utilization (30%) ───────────────────────────────────────────
  const utilRate = profile.utilizationRate ?? 0;
  let utilScore: number;
  if      (utilRate <= 0.10) utilScore = 300;
  else if (utilRate <= 0.30) utilScore = 270;
  else if (utilRate <= 0.50) utilScore = 220;
  else if (utilRate <= 0.70) utilScore = 160;
  else if (utilRate <= 0.90) utilScore = 80;
  else                       utilScore = 20;

  if (utilRate > 0.50) {
    factors.push({
      code: 'HIGH_UTILIZATION',
      description: `Credit utilization at ${Math.round(utilRate * 100)}% — above 50% threshold.`,
      impact: 'negative',
      weight: 30,
    });
  } else {
    factors.push({
      code: 'LOW_UTILIZATION',
      description: `Credit utilization at ${Math.round(utilRate * 100)}% — healthy range.`,
      impact: 'positive',
      weight: 30,
    });
  }

  // ── 3. Age of Credit (15%) ────────────────────────────────────────────────
  const createdAt = profile.createdAt ? new Date(profile.createdAt) : new Date();
  const ageMonths = Math.max(0,
    (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24 * 30.44),
  );
  let ageScore: number;
  if      (ageMonths >= 24) ageScore = 150;
  else if (ageMonths >= 12) ageScore = 120;
  else if (ageMonths >= 6)  ageScore = 90;
  else if (ageMonths >= 3)  ageScore = 60;
  else                      ageScore = 30;

  if (ageMonths < 6) {
    factors.push({
      code: 'SHORT_CREDIT_HISTORY',
      description: `Account is ${Math.round(ageMonths)} months old — limited history available.`,
      impact: 'negative',
      weight: 15,
    });
  } else {
    factors.push({
      code: 'ESTABLISHED_HISTORY',
      description: `${Math.round(ageMonths)} months of credit history.`,
      impact: 'positive',
      weight: 15,
    });
  }

  // ── 4. Credit Mix (10%) ───────────────────────────────────────────────────
  const eventTypes = new Set((profile.creditHistory ?? []).map(e => e.eventType));
  const mixCount = [
    'payment_on_time', 'credit_opened', 'hard_inquiry',
  ].filter(t => eventTypes.has(t as never)).length;
  const mixScore = Math.min(100, mixCount * 33);

  factors.push({
    code: mixCount >= 3 ? 'DIVERSE_CREDIT_MIX' : 'LIMITED_CREDIT_MIX',
    description: mixCount >= 3
      ? 'Diverse mix of credit types and activity.'
      : 'Limited variety of credit types on record.',
    impact: mixCount >= 3 ? 'positive' : 'neutral',
    weight: 10,
  });

  // ── 5. New Credit / Velocity (10%) ───────────────────────────────────────
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentInquiries = (profile.hardInquiries ?? [])
    .filter(i => new Date(i.timestamp).getTime() > thirtyDaysAgo).length;
  let velocityScore: number;
  if      (recentInquiries === 0) velocityScore = 100;
  else if (recentInquiries === 1) velocityScore = 85;
  else if (recentInquiries === 2) velocityScore = 60;
  else if (recentInquiries <= 4) velocityScore = 30;
  else                            velocityScore = 0;

  if (recentInquiries >= 2) {
    factors.push({
      code: 'HIGH_INQUIRY_VELOCITY',
      description: `${recentInquiries} hard inquiries in the last 30 days — may indicate credit stress.`,
      impact: 'negative',
      weight: 10,
    });
  }

  // ── Final score (0–1000) ──────────────────────────────────────────────────
  const raw = payScore + utilScore + ageScore + mixScore + velocityScore;
  const score = Math.round(Math.max(300, Math.min(1000, raw)));

  // Return top 4 factors sorted by weight desc
  const topFactors = factors.sort((a, b) => b.weight - a.weight).slice(0, 4);

  return { score, factors: topFactors };
}

// ── What-if simulator ─────────────────────────────────────────────────────────

export function simulateScore(
  profile: AgentCreditProfile,
  action: string,
  params: Record<string, number>,
): number {
  const clone = JSON.parse(JSON.stringify(profile)) as AgentCreditProfile;

  switch (action) {
    case 'pay_down_debt': {
      const amount = params['amount'] ?? 0;
      clone.totalDebt = Math.max(0, clone.totalDebt - amount);
      clone.utilizationRate = clone.totalCreditLimit > 0
        ? clone.totalDebt / clone.totalCreditLimit
        : 0;
      break;
    }
    case 'increase_limit': {
      const amount = params['amount'] ?? 0;
      clone.totalCreditLimit += amount;
      clone.utilizationRate = clone.totalCreditLimit > 0
        ? clone.totalDebt / clone.totalCreditLimit
        : 0;
      break;
    }
    case 'on_time_payments': {
      const count = params['count'] ?? 1;
      const total = (clone.creditHistory ?? []).length + count;
      const onTime = Math.round((clone.paymentHistoryRate * (total - count)) + count);
      clone.paymentHistoryRate = onTime / total;
      break;
    }
    case 'resolve_delinquency': {
      clone.delinquencies = clone.delinquencies.map(d =>
        d.status === 'open' ? { ...d, status: 'resolved' as const } : d,
      );
      break;
    }
  }

  return computeScore(clone).score;
}

// ── ZK Proof stub ─────────────────────────────────────────────────────────────

import { createHash } from 'crypto';

export function generateZKProof(
  profile: AgentCreditProfile,
  circuit: string,
  params: Record<string, number>,
): { proofHash: string; verified: boolean } {
  // Stub: in production this calls a Groth16 proving service
  // The proof attests to a property WITHOUT revealing underlying data
  let verified = false;

  switch (circuit) {
    case 'score_above':
      verified = profile.currentScore >= (params['threshold'] ?? 700);
      break;
    case 'no_default_last_n_months': {
      const months = params['months'] ?? 12;
      const cutoff = Date.now() - months * 30.44 * 24 * 60 * 60 * 1000;
      verified = !profile.creditHistory.some(
        e => e.eventType === 'default' && new Date(e.timestamp).getTime() > cutoff,
      );
      break;
    }
    case 'debt_under':
      verified = profile.totalDebt < (params['amount'] ?? 10000);
      break;
    case 'utilization_below':
      verified = profile.utilizationRate < (params['threshold'] ?? 0.5);
      break;
  }

  // Deterministic hash from input (not a real ZK proof)
  const proofHash = createHash('sha256')
    .update(`${profile.agentId}:${circuit}:${JSON.stringify(params)}:${verified}`)
    .digest('hex');

  return { proofHash, verified };
}

export { riskGrade, scoreTier as tierFromScore };

// ── Mode 2: On-chain operational scoring (Qova-derived factors) ───────────────
//
// These weights match Qova's CRE workflow scoring model:
//   Success Rate      30% — fraction of transactions that succeeded
//   Transaction Volume 25% — total USD volume (tiered)
//   Transaction Count  20% — number of recorded transactions (tiered)
//   Budget Compliance  15% — fraction of spend attempts within budget limits
//   Account Age        10% — months since first on-chain transaction

export function computeMode2Score(inputs: Mode2Inputs): {
  score: number;
  factors: ScoreFactor[];
} {
  const factors: ScoreFactor[] = [];

  // ── 1. Success Rate (30%) — max 300pts ────────────────────────────────────
  const successPct = inputs.successRateBps / 100;   // e.g. 9500 bps → 95%
  let successScore: number;
  if      (successPct >= 99) successScore = 300;
  else if (successPct >= 95) successScore = 270;
  else if (successPct >= 90) successScore = 220;
  else if (successPct >= 80) successScore = 150;
  else if (successPct >= 70) successScore = 80;
  else                       successScore = 20;

  factors.push({
    code: successPct >= 95 ? 'HIGH_SUCCESS_RATE' : 'LOW_SUCCESS_RATE',
    description: `${successPct.toFixed(1)}% of on-chain transactions succeeded.`,
    impact: successPct >= 90 ? 'positive' : successPct >= 75 ? 'neutral' : 'negative',
    weight: 30,
  });

  // ── 2. Transaction Volume (25%) — max 250pts ──────────────────────────────
  const vol = inputs.totalVolumeUsd;
  let volScore: number;
  if      (vol >= 1_000_000) volScore = 250;
  else if (vol >= 100_000)   volScore = 210;
  else if (vol >= 10_000)    volScore = 160;
  else if (vol >= 1_000)     volScore = 100;
  else if (vol >= 100)       volScore = 50;
  else                       volScore = 10;

  factors.push({
    code: vol >= 10_000 ? 'HIGH_VOLUME' : vol >= 100 ? 'MODERATE_VOLUME' : 'LOW_VOLUME',
    description: `$${vol.toLocaleString()} total on-chain transaction volume.`,
    impact: vol >= 10_000 ? 'positive' : vol >= 100 ? 'neutral' : 'negative',
    weight: 25,
  });

  // ── 3. Transaction Count (20%) — max 200pts ───────────────────────────────
  const cnt = inputs.totalCount;
  let cntScore: number;
  if      (cnt >= 1000) cntScore = 200;
  else if (cnt >= 100)  cntScore = 160;
  else if (cnt >= 10)   cntScore = 100;
  else if (cnt >= 3)    cntScore = 50;
  else                  cntScore = 10;

  factors.push({
    code: cnt >= 100 ? 'ACTIVE_TRANSACTION_HISTORY' : cnt >= 10 ? 'MODERATE_HISTORY' : 'THIN_HISTORY',
    description: `${cnt.toLocaleString()} total on-chain transactions recorded.`,
    impact: cnt >= 100 ? 'positive' : cnt >= 10 ? 'neutral' : 'negative',
    weight: 20,
  });

  // ── 4. Budget Compliance (15%) — max 150pts ───────────────────────────────
  const compliance = inputs.budgetComplianceRate;   // 0.0-1.0
  let complianceScore: number;
  if      (compliance >= 0.99) complianceScore = 150;
  else if (compliance >= 0.95) complianceScore = 120;
  else if (compliance >= 0.85) complianceScore = 80;
  else if (compliance >= 0.70) complianceScore = 40;
  else                         complianceScore = 0;

  factors.push({
    code: compliance >= 0.95 ? 'STRONG_BUDGET_COMPLIANCE' : 'POOR_BUDGET_COMPLIANCE',
    description: `${Math.round(compliance * 100)}% of spending attempts within configured budget limits.`,
    impact: compliance >= 0.90 ? 'positive' : compliance >= 0.70 ? 'neutral' : 'negative',
    weight: 15,
  });

  // ── 5. Account Age (10%) — max 100pts ────────────────────────────────────
  const ageMonths = inputs.accountAgeMonths;
  let ageScore: number;
  if      (ageMonths >= 24) ageScore = 100;
  else if (ageMonths >= 12) ageScore = 80;
  else if (ageMonths >= 6)  ageScore = 55;
  else if (ageMonths >= 3)  ageScore = 30;
  else                      ageScore = 10;

  factors.push({
    code: ageMonths >= 12 ? 'ESTABLISHED_ONCHAIN_HISTORY' : 'NEW_ONCHAIN_ACCOUNT',
    description: `${Math.round(ageMonths)} months of on-chain activity history.`,
    impact: ageMonths >= 12 ? 'positive' : ageMonths >= 3 ? 'neutral' : 'negative',
    weight: 10,
  });

  const raw   = successScore + volScore + cntScore + complianceScore + ageScore;
  const score = Math.round(Math.max(300, Math.min(1000, raw)));

  return { score, factors: factors.sort((a, b) => b.weight - a.weight) };
}

// ── Dual-mode composite scorer ────────────────────────────────────────────────

export function computeDualModeScore(
  agentId:     string,
  profile:     AgentCreditProfile,
  mode2Inputs: Mode2Inputs | null,
  mode2OnChain?: { txHash?: string; blockNumber?: number; chainId?: number; settledAt?: string },
): DualModeScore {
  const t0 = Date.now();

  // Mode 1: FORGE FICO (always computed, <15ms)
  const { score: m1score, factors: m1factors } = computeScore(profile);
  const m1tier = scoreTier(m1score);
  const latencyMs = Date.now() - t0;

  const mode1: Mode1Score = {
    score:               m1score,
    tier:                m1tier,
    factors:             m1factors,
    recommendation:      scoreRecommendation(m1score),
    maxRecommendedLimit: maxRecommendedLimit(m1score),
    riskGrade:           riskGrade(m1score),
    computedAt:          new Date().toISOString(),
    latencyMs,
    source:              'FORGE_FICO_OFFCHAIN',
  };

  // Mode 2: On-chain operational (only if on-chain inputs available)
  let mode2: Mode2Score | null = null;

  if (mode2Inputs !== null) {
    const { score: m2score, factors: m2factors } = computeMode2Score(mode2Inputs);
    mode2 = {
      score:             m2score,
      tier:              scoreTier(m2score),
      factors:           m2factors,
      txHash:            mode2OnChain?.txHash,
      blockNumber:       mode2OnChain?.blockNumber,
      chainId:           mode2OnChain?.chainId,
      settledAt:         mode2OnChain?.settledAt,
      source:            'FORGE_OPERATIONAL_ONCHAIN',
      verifiableOnChain: mode2Inputs.onChainSettled,
    };
  }

  // Consensus analysis
  const variance = mode2 ? Math.abs(m1score - mode2.score) : 0;
  let level: ConsensusLevel;
  let recommendation: string;
  let flagForReview: boolean;

  if (!mode2) {
    level           = 'MEDIUM';
    recommendation  = 'Mode 2 on-chain score not yet settled. Mode 1 (FICO) is authoritative.';
    flagForReview   = false;
  } else if (variance <= 50) {
    level           = 'HIGH';
    recommendation  = `Both modes agree within ${variance} points. High confidence in Mode 1 decision.`;
    flagForReview   = false;
  } else if (variance <= 100) {
    level           = 'MEDIUM';
    recommendation  = `${variance} point variance between FICO and on-chain scores. Review recommended before large credit decisions.`;
    flagForReview   = true;
  } else {
    level           = 'LOW';
    recommendation  = `${variance} point divergence detected. On-chain behavior and FICO profile are misaligned. Manual review required.`;
    flagForReview   = true;
  }

  return {
    agentId,
    mode1,
    mode2,
    consensus: {
      level,
      variance,
      authoritative:  'MODE_1',
      recommendation,
      flagForReview,
    },
    generatedAt: new Date().toISOString(),
  };
}
