/**
 * Decision Policy Store
 *
 * Holds two collections:
 *   - Global DecisionPolicy[]   — rule-based gates evaluated for every request
 *   - Per-agent AgentPolicy     — overrides (risk tolerance, daily limit,
 *                                 counterparty blocklist, approval threshold)
 *
 * In production both stores would live in Postgres with an audit trail. Here
 * we use in-memory Maps seeded with sensible defaults.
 */

import { AgentPolicy, DecisionPolicy } from './types';

// ── Global policies ───────────────────────────────────────────────────────────

const policies: Map<string, DecisionPolicy> = new Map();

const DEFAULT_POLICIES: DecisionPolicy[] = [
  { id: 'p1', name: 'Block sub-30 reputation', type: 'block_low_reputation',    params: { minReputation: 30 },     enabled: true },
  { id: 'p2', name: 'Approval over $50k',      type: 'require_approval_above',  params: { thresholdUsd: 50_000 },  enabled: true },
  { id: 'p3', name: 'Block over $500k',        type: 'block_high_amount',       params: { maxAmountUsd: 500_000 }, enabled: true },
];

function seed(): void {
  if (policies.size === 0) {
    for (const p of DEFAULT_POLICIES) policies.set(p.id, { ...p, params: { ...p.params } });
  }
}
seed();

export function listPolicies(): DecisionPolicy[] {
  return Array.from(policies.values());
}

export function getPolicy(id: string): DecisionPolicy | undefined {
  return policies.get(id);
}

export function addPolicy(policy: DecisionPolicy): DecisionPolicy {
  policies.set(policy.id, policy);
  return policy;
}

export function updatePolicy(id: string, patch: Partial<DecisionPolicy>): DecisionPolicy | null {
  const existing = policies.get(id);
  if (!existing) return null;
  const merged: DecisionPolicy = {
    ...existing,
    ...patch,
    id,
    params: { ...existing.params, ...(patch.params ?? {}) },
  };
  policies.set(id, merged);
  return merged;
}

export function deletePolicy(id: string): boolean {
  return policies.delete(id);
}

export function resetPolicies(): void {
  policies.clear();
  seed();
}

// ── Per-agent policies ────────────────────────────────────────────────────────

const agentPolicies: Map<string, AgentPolicy> = new Map();

export const DEFAULT_AGENT_POLICY: Omit<AgentPolicy, 'agentId'> = {
  riskTolerance:                50,
  dailyLimitUsd:                250_000,
  blockedCounterparties:        [],
  requiredApprovalThresholdUsd: 50_000,
};

export function getAgentPolicy(agentId: string): AgentPolicy {
  const existing = agentPolicies.get(agentId);
  if (existing) return existing;
  return { agentId, ...DEFAULT_AGENT_POLICY };
}

export function setAgentPolicy(agentId: string, patch: Partial<Omit<AgentPolicy, 'agentId'>>): AgentPolicy {
  const current = getAgentPolicy(agentId);
  const merged: AgentPolicy = {
    ...current,
    ...patch,
    agentId,
    blockedCounterparties: patch.blockedCounterparties ?? current.blockedCounterparties,
  };
  agentPolicies.set(agentId, merged);
  return merged;
}

export function clearAgentPolicies(): void {
  agentPolicies.clear();
}
