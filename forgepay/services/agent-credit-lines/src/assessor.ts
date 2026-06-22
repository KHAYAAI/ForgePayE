/**
 * Credit Assessment Engine
 *
 * Calls the agent-identity service to fetch an agent's reputation score and
 * transaction history, then applies a tiered decision matrix to recommend a
 * credit limit, term length, and interest rate. The matrix favors agents
 * with both high reputation AND sustained on-chain activity.
 *
 * Tiers:
 *   reputation ≥ 80 + > 100 txns → $100k @ 60d @ 6.0% APR
 *   reputation ≥ 60 + >  50 txns → $25k  @ 30d @ 9.0% APR
 *   reputation ≥ 40 + >  10 txns → $5k   @ 30d @ 12.0% APR
 *   otherwise                    → declined
 *
 * Reputation cache: results are cached for CACHE_TTL_MS to avoid hammering
 * agent-identity on high-frequency assessment calls.
 */

import { CreditAssessment, CreditTerms } from './types';

const AGENT_IDENTITY_URL = process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010';
const FETCH_TIMEOUT_MS   = 5_000;
const CACHE_TTL_MS       = 5 * 60_000; // 5-minute TTL

interface CachedReputation {
  reputation: number;
  txCount:    number;
  fetchedAt:  number;
}

const reputationCache = new Map<string, CachedReputation>();

interface ReputationResponse {
  reputationScore?: number;
  score?: number;
  transactionCount?: number;
  txCount?: number;
}

async function fetchReputation(agentId: string): Promise<{ reputation: number; txCount: number }> {
  const cached = reputationCache.get(agentId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return { reputation: cached.reputation, txCount: cached.txCount };
  }

  const resp = await fetch(
    `${AGENT_IDENTITY_URL}/v1/agents/${encodeURIComponent(agentId)}/reputation`,
    {
      signal:  AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'Accept': 'application/json', 'x-source': 'agent-credit-lines' },
    },
  );
  if (!resp.ok) throw new Error(`agent-identity returned ${resp.status}`);
  const body = (await resp.json()) as ReputationResponse;
  const reputation = typeof body.reputationScore === 'number'
    ? body.reputationScore
    : (typeof body.score === 'number' ? body.score : 0);
  const txCount = typeof body.transactionCount === 'number'
    ? body.transactionCount
    : (typeof body.txCount === 'number' ? body.txCount : 0);

  reputationCache.set(agentId, { reputation, txCount, fetchedAt: Date.now() });
  return { reputation, txCount };
}

export async function assessAgent(agentId: string): Promise<CreditAssessment> {
  let reputation: number;
  let txCount:    number;

  try {
    ({ reputation, txCount } = await fetchReputation(agentId));
  } catch (err) {
    return {
      agentId,
      approved:                   false,
      recommendedLimitUsd:        0,
      recommendedTermsDays:       30 as CreditTerms,
      recommendedInterestRateBps: 0,
      reasons: ['reputation_service_unavailable'],
    };
  }

  // ── Tier 1: prime ───────────────────────────────────────────────────────────
  if (reputation >= 80 && txCount > 100) {
    return {
      agentId,
      approved:                   true,
      recommendedLimitUsd:        100_000,
      recommendedTermsDays:       60,
      recommendedInterestRateBps: 600,
      reasons: ['tier_prime', 'high_reputation', 'extensive_history'],
      reputationScore:  reputation,
      transactionCount: txCount,
    };
  }

  // ── Tier 2: standard ────────────────────────────────────────────────────────
  if (reputation >= 60 && txCount > 50) {
    return {
      agentId,
      approved:                   true,
      recommendedLimitUsd:        25_000,
      recommendedTermsDays:       30,
      recommendedInterestRateBps: 900,
      reasons: ['tier_standard', 'good_reputation'],
      reputationScore:  reputation,
      transactionCount: txCount,
    };
  }

  // ── Tier 3: starter ─────────────────────────────────────────────────────────
  if (reputation >= 40 && txCount > 10) {
    return {
      agentId,
      approved:                   true,
      recommendedLimitUsd:        5_000,
      recommendedTermsDays:       30,
      recommendedInterestRateBps: 1200,
      reasons: ['tier_starter', 'minimum_qualifications_met'],
      reputationScore:  reputation,
      transactionCount: txCount,
    };
  }

  // ── Declined ────────────────────────────────────────────────────────────────
  const reasons: string[] = [];
  if (reputation < 40) reasons.push('insufficient_reputation');
  if (txCount <= 10)   reasons.push('insufficient_history');
  if (reasons.length === 0) reasons.push('does_not_meet_tier_criteria');

  return {
    agentId,
    approved:                   false,
    recommendedLimitUsd:        0,
    recommendedTermsDays:       30,
    recommendedInterestRateBps: 0,
    reasons,
    reputationScore:  reputation,
    transactionCount: txCount,
  };
}
