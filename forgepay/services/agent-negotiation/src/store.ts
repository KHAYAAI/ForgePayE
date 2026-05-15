/**
 * In-memory store for Agent Negotiation Protocol.
 * Production: replace Maps with a persistent database (PostgreSQL / Redis).
 */

import type { NegotiationSession, Escrow } from './types';

// ── In-memory Maps ────────────────────────────────────────────────────────────

const sessionMap = new Map<string, NegotiationSession>();
const escrowMap  = new Map<string, Escrow>();

// ── Sessions ──────────────────────────────────────────────────────────────────

export function getSession(id: string): NegotiationSession | undefined {
  return sessionMap.get(id);
}

export function setSession(session: NegotiationSession): void {
  sessionMap.set(session.id, session);
}

export function listSessions(filter: { agentId?: string; status?: NegotiationSession['status'] } = {}): NegotiationSession[] {
  let results = Array.from(sessionMap.values());

  if (filter.agentId) {
    results = results.filter(
      s => s.initiatorAgentId === filter.agentId || s.responderAgentId === filter.agentId
    );
  }
  if (filter.status) {
    results = results.filter(s => s.status === filter.status);
  }

  // Most recent first
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Escrows ───────────────────────────────────────────────────────────────────

export function getEscrow(id: string): Escrow | undefined {
  return escrowMap.get(id);
}

export function setEscrow(escrow: Escrow): void {
  escrowMap.set(escrow.id, escrow);
}

// ── Seed Data ─────────────────────────────────────────────────────────────────

const NOW     = new Date().toISOString();
const PAST    = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days ago
const EXPIRES = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // expired yesterday

const seedSession: NegotiationSession = {
  id:               'session-demo-1',
  initiatorAgentId: 'marketplace-buyer-1',
  responderAgentId: 'treasury-oracle-1',
  subject:          'Treasury yield optimization API access',
  status:           'settled',
  messages: [
    {
      id:          'msg-demo-1',
      sessionId:   'session-demo-1',
      fromAgentId: 'marketplace-buyer-1',
      toAgentId:   'treasury-oracle-1',
      role:        'offer',
      terms:       [
        { key: 'price_usd', value: 200, unit: 'USD' },
        { key: 'access_duration_days', value: 30, unit: 'days' },
        { key: 'api_calls_per_day', value: 1000 },
      ],
      message:   'Requesting API access for treasury yield optimization data',
      timestamp: PAST,
    },
    {
      id:          'msg-demo-2',
      sessionId:   'session-demo-1',
      fromAgentId: 'treasury-oracle-1',
      toAgentId:   'marketplace-buyer-1',
      role:        'counter_offer',
      terms:       [
        { key: 'price_usd', value: 250, unit: 'USD' },
        { key: 'access_duration_days', value: 30, unit: 'days' },
        { key: 'api_calls_per_day', value: 1000 },
        { key: 'sla_uptime_percent', value: 99.9 },
      ],
      message:   'Counter with 99.9% SLA guarantee and slight price adjustment',
      timestamp: PAST,
    },
    {
      id:          'msg-demo-3',
      sessionId:   'session-demo-1',
      fromAgentId: 'marketplace-buyer-1',
      toAgentId:   'treasury-oracle-1',
      role:        'accept',
      terms:       [
        { key: 'price_usd', value: 250, unit: 'USD' },
        { key: 'access_duration_days', value: 30, unit: 'days' },
        { key: 'api_calls_per_day', value: 1000 },
        { key: 'sla_uptime_percent', value: 99.9 },
      ],
      message:   'Accepted — proceeding to escrow',
      timestamp: PAST,
    },
  ],
  agreedTerms: [
    { key: 'price_usd', value: 250, unit: 'USD' },
    { key: 'access_duration_days', value: 30, unit: 'days' },
    { key: 'api_calls_per_day', value: 1000 },
    { key: 'sla_uptime_percent', value: 99.9 },
  ],
  escrowId:        'escrow-demo-1',
  totalRounds:     3,
  maxRounds:       10,
  createdAt:       PAST,
  updatedAt:       PAST,
  expiresAt:       EXPIRES,
  settlementTxId:  'tx-demo-settle-abc123',
};

const seedEscrow: Escrow = {
  id:            'escrow-demo-1',
  sessionId:     'session-demo-1',
  buyerAgentId:  'marketplace-buyer-1',
  sellerAgentId: 'treasury-oracle-1',
  amountUsd:     250,
  asset:         'USDC',
  chain:         'base',
  status:        'released',
  fundedAt:      PAST,
  releasedAt:    PAST,
  createdAt:     PAST,
};

setSession(seedSession);
setEscrow(seedEscrow);
