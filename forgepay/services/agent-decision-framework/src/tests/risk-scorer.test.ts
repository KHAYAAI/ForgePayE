import { describe, it, expect } from 'vitest';
import { computeRiskScore, decide } from '../risk-scorer';
import type {
  AgentPolicy,
  DecisionPolicy,
  DecisionRequest,
  VelocityWindow,
} from '../types';

function makeAgentPolicy(overrides: Partial<AgentPolicy> = {}): AgentPolicy {
  return {
    agentId:                      'agent-A',
    riskTolerance:                50,
    dailyLimitUsd:                250_000,
    blockedCounterparties:        [],
    requiredApprovalThresholdUsd: 50_000,
    ...overrides,
  };
}

function makeRequest(overrides: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    agentId:    'agent-A',
    actionType: 'payment',
    amountUsd:  1_000,
    asset:      'USDC',
    ...overrides,
  };
}

function makeVelocity(overrides: Partial<VelocityWindow> = {}): VelocityWindow {
  return {
    agentId:    'agent-A',
    last1hUsd:  0,
    last24hUsd: 0,
    last7dUsd:  0,
    txCount1h:  0,
    txCount24h: 0,
    txCount7d:  0,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('risk-scorer', () => {
  it('returns approve with low score for a small benign request', () => {
    const decision = decide({
      request:     makeRequest({ amountUsd: 100 }),
      agentPolicy: makeAgentPolicy(),
      policies:    [],
      velocity:    makeVelocity(),
    });
    expect(decision.decision).toBe('approve');
    expect(decision.score).toBeLessThan(50);
  });

  it('adds 40 reputation points when counterparty reputation is below 30', () => {
    const { score } = computeRiskScore({
      request:     makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100 }),
      agentPolicy: makeAgentPolicy(),
      policies:    [],
      velocity:    makeVelocity(),
      reputation:  10,
    });
    expect(score.components.counterpartyReputation).toBe(40);
  });

  it('adds 20 reputation points for mid-band reputation (30-60)', () => {
    const { score } = computeRiskScore({
      request:     makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100 }),
      agentPolicy: makeAgentPolicy(),
      policies:    [],
      velocity:    makeVelocity(),
      reputation:  45,
    });
    expect(score.components.counterpartyReputation).toBe(20);
  });

  it('adds 0 reputation points when reputation is above 60', () => {
    const { score } = computeRiskScore({
      request:     makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100 }),
      agentPolicy: makeAgentPolicy(),
      policies:    [],
      velocity:    makeVelocity(),
      reputation:  90,
    });
    expect(score.components.counterpartyReputation).toBe(0);
  });

  it('caps amount factor at 25 even for huge amounts', () => {
    const { score } = computeRiskScore({
      request:     makeRequest({ amountUsd: 10_000_000 }),
      agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000 }),
      policies:    [],
      velocity:    makeVelocity(),
    });
    expect(score.components.amountFactor).toBe(25);
  });

  it('caps velocity at 20 when projected 24h volume exceeds daily limit', () => {
    const { score } = computeRiskScore({
      request:     makeRequest({ amountUsd: 100_000 }),
      agentPolicy: makeAgentPolicy({ dailyLimitUsd: 100_000 }),
      policies:    [],
      velocity:    makeVelocity({ last24hUsd: 500_000 }),
    });
    expect(score.components.velocity).toBe(20);
  });

  it('require_approval when amount exceeds approval threshold even with clean signals', () => {
    const decision = decide({
      request:     makeRequest({ amountUsd: 60_000 }),
      agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 10_000_000 }),
      policies:    [],
      velocity:    makeVelocity(),
    });
    expect(decision.decision).toBe('require_approval');
  });

  it('rejects when final score >= 80', () => {
    // reputation 40 + amount 25 + velocity 20 = 85
    const decision = decide({
      request:     makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 200_000 }),
      agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 100_000 }),
      policies:    [],
      velocity:    makeVelocity({ last24hUsd: 200_000 }),
      reputation:  5,
    });
    expect(decision.score).toBeGreaterThanOrEqual(80);
    expect(decision.decision).toBe('reject');
  });

  it('require_approval band activates at 50 ≤ score < 80', () => {
    // amount 25 + reputation 20 = 45 → bump with a tiny velocity → 50+
    const decision = decide({
      request:     makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100_000 }),
      agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 1_000_000 }),
      policies:    [],
      velocity:    makeVelocity({ last24hUsd: 250_000 }),
      reputation:  45,
    });
    expect(decision.score).toBeGreaterThanOrEqual(50);
    expect(decision.score).toBeLessThan(80);
    expect(decision.decision).toBe('require_approval');
  });

  it('automatic reject when counterparty is in agent blocklist regardless of score', () => {
    const decision = decide({
      request:     makeRequest({ counterpartyAgentId: 'evil-1', amountUsd: 100 }),
      agentPolicy: makeAgentPolicy({ blockedCounterparties: ['evil-1'] }),
      policies:    [],
      velocity:    makeVelocity(),
      reputation:  100,
    });
    expect(decision.decision).toBe('reject');
    expect(decision.reasons.some(r => r.includes('blocklist'))).toBe(true);
  });

  it('matches block_high_amount policy and reports violation', () => {
    const policy: DecisionPolicy = {
      id: 'pHA', name: 'block over 1000', type: 'block_high_amount',
      params: { maxAmountUsd: 1_000 }, enabled: true,
    };
    const { matchedPolicyIds, score } = computeRiskScore({
      request:     makeRequest({ amountUsd: 5_000 }),
      agentPolicy: makeAgentPolicy(),
      policies:    [policy],
      velocity:    makeVelocity(),
    });
    expect(matchedPolicyIds).toContain('pHA');
    expect(score.components.policyViolations).toBe(15);
  });

  it('policy violations are capped at 15 even with multiple matches', () => {
    const policies: DecisionPolicy[] = [
      { id: 'a', name: 'a', type: 'block_high_amount',      params: { maxAmountUsd: 100 },   enabled: true },
      { id: 'b', name: 'b', type: 'require_approval_above', params: { thresholdUsd:  100 },  enabled: true },
    ];
    const { score, matchedPolicyIds } = computeRiskScore({
      request:     makeRequest({ amountUsd: 5_000 }),
      agentPolicy: makeAgentPolicy(),
      policies,
      velocity:    makeVelocity(),
    });
    expect(matchedPolicyIds.length).toBe(2);
    expect(score.components.policyViolations).toBe(15);
  });

  it('skips disabled policies', () => {
    const policies: DecisionPolicy[] = [
      { id: 'off', name: 'off', type: 'block_high_amount', params: { maxAmountUsd: 100 }, enabled: false },
    ];
    const { matchedPolicyIds, score } = computeRiskScore({
      request:     makeRequest({ amountUsd: 5_000 }),
      agentPolicy: makeAgentPolicy(),
      policies,
      velocity:    makeVelocity(),
    });
    expect(matchedPolicyIds).toHaveLength(0);
    expect(score.components.policyViolations).toBe(0);
  });

  it('total score is clamped to 100', () => {
    const policies: DecisionPolicy[] = [
      { id: 'x', name: 'x', type: 'block_high_amount', params: { maxAmountUsd: 100 }, enabled: true },
    ];
    const { score } = computeRiskScore({
      request:     makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 10_000_000 }),
      agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 1_000 }),
      policies,
      velocity:    makeVelocity({ last24hUsd: 10_000_000 }),
      reputation:  0,
    });
    expect(score.total).toBeLessThanOrEqual(100);
  });
});
