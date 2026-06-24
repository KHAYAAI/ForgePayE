/**
 * Reputation Engine — computes score deltas, updates trust levels, and persists events.
 */

import { v4 as uuidv4 } from 'uuid';
import type { ReputationEvent, TrustLevel } from './types';
import { getAgent, setAgent, pushReputationEvent } from './store';

// ── Score delta table ─────────────────────────────────────────────────────

const SCORE_DELTAS: Record<ReputationEvent['eventType'], number> = {
  transaction_success: +5,
  transaction_failure: -10,
  dispute_raised: -20,
  dispute_resolved: +15,
  late_payment: -8,
  fraud_detected: -100,
  vouched_by_trusted: +30,
};

// ── Trust level thresholds ────────────────────────────────────────────────

function computeTrustLevel(score: number): TrustLevel {
  if (score > 800) return 'premium';
  if (score > 500) return 'trusted';
  if (score >= 200) return 'verified';
  return 'unverified';
}

// ── Public API ────────────────────────────────────────────────────────────

export interface RecordEventOptions {
  relatedAgentId?: string;
  transactionId?: string;
}

export async function recordReputationEvent(
  agentId: string,
  eventType: ReputationEvent['eventType'],
  description: string,
  options: RecordEventOptions = {}
): Promise<ReputationEvent | { error: string }> {
  const agent = await getAgent(agentId);
  if (!agent) {
    return { error: `Agent ${agentId} not found` };
  }

  const delta = SCORE_DELTAS[eventType];

  // Clamp score to [0, 1000]
  const newScore = Math.max(0, Math.min(1000, agent.reputationScore + delta));

  // Update success rate based on transaction events
  let newSuccessRate = agent.successRate;
  if (eventType === 'transaction_success') {
    const total = agent.totalTransactions + 1;
    newSuccessRate = (agent.successRate * agent.totalTransactions + 1) / total;
  } else if (eventType === 'transaction_failure') {
    const total = agent.totalTransactions + 1;
    newSuccessRate = (agent.successRate * agent.totalTransactions) / total;
  }

  const updatedAgent = {
    ...agent,
    reputationScore: newScore,
    trustLevel: computeTrustLevel(newScore),
    successRate: newSuccessRate,
    totalTransactions:
      eventType === 'transaction_success' || eventType === 'transaction_failure'
        ? agent.totalTransactions + 1
        : agent.totalTransactions,
    lastActiveAt: new Date().toISOString(),
  };

  await setAgent(updatedAgent);

  const event: ReputationEvent = {
    id: uuidv4(),
    agentId,
    eventType,
    scoreDelta: delta,
    description,
    relatedAgentId: options.relatedAgentId,
    transactionId: options.transactionId,
    createdAt: new Date().toISOString(),
  };

  await pushReputationEvent(event);
  return event;
}
