/**
 * In-memory store for Agent Identity Registry.
 * Production: replace Maps with a persistent database (PostgreSQL / Redis).
 */

import type { AgentIdentity, ReputationEvent, Attestation } from './types';

// ── In-memory Maps ────────────────────────────────────────────────────────────

const agentMap     = new Map<string, AgentIdentity>();
const reputationMap = new Map<string, ReputationEvent[]>();
const attestationMap = new Map<string, Attestation>();

// ── Agents ────────────────────────────────────────────────────────────────────

export interface AgentFilter {
  framework?:    AgentIdentity['framework'];
  trustLevel?:   AgentIdentity['trustLevel'];
  capability?:   string;
  tag?:          string;
  minReputation?: number;
  status?:       AgentIdentity['status'];
  limit?:        number;
}

export function getAgent(id: string): AgentIdentity | undefined {
  // Support lookup by DID as well
  if (id.startsWith('did:forgepay:')) {
    const extracted = id.replace('did:forgepay:', '');
    return agentMap.get(extracted);
  }
  return agentMap.get(id);
}

export function setAgent(agent: AgentIdentity): void {
  agentMap.set(agent.id, agent);
}

export function listAgents(filter: AgentFilter = {}): AgentIdentity[] {
  let results = Array.from(agentMap.values());

  if (filter.status !== undefined) {
    results = results.filter(a => a.status === filter.status);
  } else {
    // Default: exclude deregistered agents
    results = results.filter(a => a.status !== 'deregistered');
  }

  if (filter.framework) {
    results = results.filter(a => a.framework === filter.framework);
  }
  if (filter.trustLevel) {
    results = results.filter(a => a.trustLevel === filter.trustLevel);
  }
  if (filter.capability) {
    results = results.filter(a => a.capabilities.includes(filter.capability!));
  }
  if (filter.tag) {
    results = results.filter(a => a.tags.includes(filter.tag!));
  }
  if (filter.minReputation !== undefined) {
    results = results.filter(a => a.reputationScore >= filter.minReputation!);
  }

  const limit = filter.limit ?? 20;
  return results.slice(0, limit);
}

// ── Reputation Events ─────────────────────────────────────────────────────────

export function pushReputationEvent(event: ReputationEvent): void {
  const events = reputationMap.get(event.agentId) ?? [];
  events.push(event);
  reputationMap.set(event.agentId, events);
}

export function getReputationEventsByAgentId(agentId: string): ReputationEvent[] {
  return reputationMap.get(agentId) ?? [];
}

// ── Attestations ──────────────────────────────────────────────────────────────

export function getAttestation(id: string): Attestation | undefined {
  return attestationMap.get(id);
}

export function setAttestation(attestation: Attestation): void {
  attestationMap.set(attestation.id, attestation);
}

export function getAttestationsBySubjectAgentId(subjectAgentId: string): Attestation[] {
  return Array.from(attestationMap.values()).filter(
    a => a.subjectAgentId === subjectAgentId
  );
}

// ── Seed Data ─────────────────────────────────────────────────────────────────

const NOW = new Date().toISOString();

const seedAgent1: AgentIdentity = {
  id:                   'treasury-oracle-1',
  did:                  'did:forgepay:treasury-oracle-1',
  name:                 'Treasury Oracle',
  framework:            'forgepay',
  ownerMerchantId:      'merchant-forgepay-internal',
  capabilities:         ['payment', 'treasury', 'yield'],
  trustLevel:           'trusted',
  reputationScore:      820,
  totalTransactions:    1240,
  totalVolumeUsd:       4_850_000,
  successRate:          0.98,
  averageResponseTimeMs: 320,
  tags:                 ['treasury', 'yield', 'institutional'],
  createdAt:            NOW,
  lastActiveAt:         NOW,
  status:               'active',
};

const seedAgent2: AgentIdentity = {
  id:                   'marketplace-buyer-1',
  did:                  'did:forgepay:marketplace-buyer-1',
  name:                 'Marketplace Buyer Agent',
  framework:            'elizaos',
  ownerMerchantId:      'merchant-demo-marketplace',
  capabilities:         ['payment', 'negotiation'],
  trustLevel:           'verified',
  reputationScore:      650,
  totalTransactions:    342,
  totalVolumeUsd:       275_000,
  successRate:          0.94,
  averageResponseTimeMs: 480,
  tags:                 ['marketplace', 'data_broker'],
  createdAt:            NOW,
  lastActiveAt:         NOW,
  status:               'active',
};

setAgent(seedAgent1);
setAgent(seedAgent2);
