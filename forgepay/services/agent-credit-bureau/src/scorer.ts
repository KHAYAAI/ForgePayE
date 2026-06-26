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

import type { AgentCreditProfile, CreditTier, ScoreFactor } from './types';

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
  const hasDefault  = (profile.creditHistory ?? []).some(e => e.eventType === 'default');

  let payScore = payRate * 350;
  if (delinqCount > 0) payScore -= delinqCount * 40;
  if (hasDefault)      payScore -= 120;
  payScore = Math.max(0, Math.min(350, payScore));

  if (payRate < 0.8 || hasDefault) {
    factors.push({
      code: hasDefault ? 'RECENT_DEFAULT' : 'LATE_PAYMENTS',
      description: hasDefault
        ? 'One or more accounts in default significantly impact the score.'
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
