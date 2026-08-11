/**
 * Dispute resolution.
 *
 * The regression these guard: a `resolved_corrected` or `resolved_deleted`
 * outcome updated only the dispute record — `profile.creditHistory` was never
 * touched and the score was never recomputed, so the disputed data survived
 * its own deletion. A lender pulling the report a minute after "resolution"
 * saw exactly what the agent had just disputed and won.
 */
import { describe, expect, it, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import {
  resolveDispute,
  isPastEscalationDeadline,
  withEscalationCheck,
  furnisherForEvent,
  DISPUTE_ESCALATION_DAYS,
} from './disputes';
import { deriveScoreFields } from './store';
import type { AgentCreditProfile, Dispute } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

function profile(over: Partial<AgentCreditProfile> = {}): AgentCreditProfile {
  const base = {
    agentId: 'agent_test',
    did: 'did:forge:agent_test',
    operatorEntityId: 'EIN-1',
    operatorEntityType: 'llc',
    creditHistory: [
      { id: 'evt_default', agentId: 'agent_test', eventType: 'default', amount: 1000,
        creditorId: 'furnisher_a', contributorId: 'furnisher_a',
        description: 'Failed to repay', timestamp: '2024-01-01T00:00:00Z' },
      { id: 'evt_ontime', agentId: 'agent_test', eventType: 'payment_on_time', amount: 100,
        creditorId: 'furnisher_a', contributorId: 'furnisher_a',
        description: 'On time', timestamp: '2024-02-01T00:00:00Z' },
    ],
    // Deliberately mid-range and not floor-clamped, so a resolution's effect
    // on the score is directly observable rather than absorbed by a clamp.
    totalDebt: 3000,
    totalCreditLimit: 10000,
    utilizationRate: 0.30,
    paymentHistoryRate: 0.85,
    delinquencies: [],
    hardInquiries: [],
    createdAt: '2020-01-01T00:00:00Z',
    lastUpdatedAt: '2024-01-01T00:00:00Z',
    ...over,
  } as Omit<AgentCreditProfile, 'scoreFactors' | 'tier' | 'currentScore'>;
  return deriveScoreFields(base);
}

function dispute(over: Partial<Dispute> = {}): Dispute {
  return {
    id: 'disp_test',
    agentId: 'agent_test',
    eventId: 'evt_default',
    status: 'open',
    filedAt: '2024-01-05T00:00:00Z',
    description: 'This default was reported in error.',
    furnisherId: 'furnisher_a',
    ...over,
  };
}

describe('resolveDispute — resolved_deleted', () => {
  it('removes the disputed event and re-derives a genuinely different score', () => {
    const p = profile();
    const before = p.currentScore;
    const hadDefaultFactor = p.scoreFactors.some(f => f.code === 'RECENT_DEFAULT');
    expect(hadDefaultFactor).toBe(true);

    const result = resolveDispute({ profile: p, dispute: dispute(), status: 'resolved_deleted' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.historyChanged).toBe(true);
    expect(result.profile.creditHistory.find(e => e.id === 'evt_default')).toBeUndefined();
    expect(result.profile.creditHistory).toHaveLength(1);
    // The score genuinely moved — not just the factor list.
    expect(result.profile.currentScore).not.toBe(before);
    expect(result.profile.scoreFactors.some(f => f.code === 'RECENT_DEFAULT')).toBe(false);
    expect(result.dispute.status).toBe('resolved_deleted');
    expect(result.dispute.resolvedAt).toBeTruthy();
  });

  it('404s (event_not_found) when the disputed event is already gone', () => {
    const p = profile({ creditHistory: [] });
    const result = resolveDispute({ profile: p, dispute: dispute(), status: 'resolved_deleted' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('event_not_found');
  });
});

describe('resolveDispute — resolved_corrected', () => {
  it('requires a correction — an outcome cannot just assert the original was wrong', () => {
    const result = resolveDispute({ profile: profile(), dispute: dispute(), status: 'resolved_corrected' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('correction_required');
  });

  it('rejects an empty correction object the same as a missing one', () => {
    const result = resolveDispute({
      profile: profile(), dispute: dispute(), status: 'resolved_corrected', correction: {},
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('correction_required');
  });

  it('updates the event in place and re-derives the score', () => {
    const p = profile();
    const before = p.currentScore;

    const result = resolveDispute({
      profile: p, dispute: dispute(), status: 'resolved_corrected',
      correction: { eventType: 'payment_on_time', description: 'Was actually paid on time' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.historyChanged).toBe(true);
    // Corrected in place — not removed, and the event id is unchanged.
    expect(result.profile.creditHistory).toHaveLength(2);
    const corrected = result.profile.creditHistory.find(e => e.id === 'evt_default')!;
    expect(corrected.eventType).toBe('payment_on_time');
    expect(corrected.description).toBe('Was actually paid on time');
    expect(result.profile.currentScore).not.toBe(before);
  });

  it('leaves fields the correction does not mention untouched', () => {
    const p = profile();
    const result = resolveDispute({
      profile: p, dispute: dispute(), status: 'resolved_corrected',
      correction: { eventType: 'payment_on_time' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const corrected = result.profile.creditHistory.find(e => e.id === 'evt_default')!;
    expect(corrected.amount).toBe(1000); // unchanged
    expect(corrected.creditorId).toBe('furnisher_a'); // unchanged
  });
});

describe('resolveDispute — resolved_upheld and investigating', () => {
  it('resolved_upheld resolves the dispute without touching credit history', () => {
    const p = profile();
    const result = resolveDispute({ profile: p, dispute: dispute(), status: 'resolved_upheld' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.historyChanged).toBe(false);
    expect(result.profile).toBe(p); // literally the same object — no re-derivation
    expect(result.dispute.status).toBe('resolved_upheld');
    expect(result.dispute.resolvedAt).toBeTruthy();
  });

  it('investigating advances status without resolving or touching history', () => {
    const result = resolveDispute({ profile: profile(), dispute: dispute(), status: 'investigating' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.historyChanged).toBe(false);
    expect(result.dispute.resolvedAt).toBeUndefined();
  });
});

describe('resolveDispute — cannot be re-resolved', () => {
  it('refuses to act on an already-resolved dispute', () => {
    const resolved = dispute({ status: 'resolved_upheld', resolvedAt: '2024-02-01T00:00:00Z' });
    const result = resolveDispute({ profile: profile(), dispute: resolved, status: 'resolved_deleted' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('already_resolved');
  });
});

describe('furnisherForEvent', () => {
  it('reads provenance from the event, not from thin air', () => {
    const p = profile();
    const event = p.creditHistory.find(e => e.id === 'evt_default');
    expect(furnisherForEvent(event)).toBe('furnisher_a');
  });

  it('is undefined for an event with no contributorId (legacy/pre-1b data)', () => {
    expect(furnisherForEvent({
      id: 'e', agentId: 'a', eventType: 'payment_on_time', description: 'x', timestamp: 'now',
    })).toBeUndefined();
    expect(furnisherForEvent(undefined)).toBeUndefined();
  });
});

describe('escalation', () => {
  const oldDispute = (status: Dispute['status'] = 'open') =>
    dispute({ status, filedAt: new Date(Date.now() - (DISPUTE_ESCALATION_DAYS + 1) * DAY_MS).toISOString() });

  it('flags a still-open dispute past the deadline', () => {
    expect(isPastEscalationDeadline(oldDispute())).toBe(true);
    expect(isPastEscalationDeadline(oldDispute('investigating'))).toBe(true);
  });

  it('does not flag a dispute within the window', () => {
    const fresh = dispute({ filedAt: new Date(Date.now() - 5 * DAY_MS).toISOString() });
    expect(isPastEscalationDeadline(fresh)).toBe(false);
  });

  it('does not flag a resolved dispute, however old', () => {
    expect(isPastEscalationDeadline(oldDispute('resolved_upheld'))).toBe(false);
  });

  it('does not re-flag a dispute that already carries escalatedAt', () => {
    const already = { ...oldDispute(), escalatedAt: '2024-01-01T00:00:00Z' };
    expect(isPastEscalationDeadline(already)).toBe(false);
  });

  it('withEscalationCheck stamps escalatedAt only when due', () => {
    const stamped = withEscalationCheck(oldDispute());
    expect(stamped.escalatedAt).toBeTruthy();

    const fresh = dispute({ filedAt: new Date().toISOString() });
    expect(withEscalationCheck(fresh)).toBe(fresh); // same object — no-op
  });
});

// ── End to end, through the real routes ─────────────────────────────────────

const ADMIN = 'dev-bureau-admin-key';
const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

describe('end to end', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  it('derives furnisherId from the disputed event and rejects a contradicting claim', async () => {
    const mismatch = await app.inject({
      method: 'POST', url: '/v1/agents/agent_prime_001/disputes', headers: bearer(ADMIN),
      payload: { eventId: 'evt_002', description: 'testing mismatch rejection', furnisherId: 'someone_else' },
    });
    expect(mismatch.statusCode).toBe(400);

    const ok = await app.inject({
      method: 'POST', url: '/v1/agents/agent_prime_001/disputes', headers: bearer(ADMIN),
      payload: { eventId: 'evt_002', description: 'testing auto-derivation' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.furnisherId).toBe('fp_internal');
  });

  it('rejects filing against an eventId that does not exist on the agent', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/agents/agent_prime_001/disputes', headers: bearer(ADMIN),
      payload: { eventId: 'nope_not_real', description: 'this event does not exist' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('resolves the seeded disp_001 end to end and the event leaves the credit history', async () => {
    const before = await app.inject({ method: 'GET', url: '/v1/agents/agent_deep_001/history', headers: bearer(ADMIN) });
    expect(before.json().data.some((e: { id: string }) => e.id === 'evt_041')).toBe(true);

    const resolved = await app.inject({
      method: 'PUT', url: '/v1/disputes/disp_001', headers: bearer(ADMIN),
      payload: { status: 'resolved_deleted', resolution: 'On-chain payment confirmed.' },
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.status).toBe('resolved_deleted');

    const after = await app.inject({ method: 'GET', url: '/v1/agents/agent_deep_001/history', headers: bearer(ADMIN) });
    expect(after.json().data.some((e: { id: string }) => e.id === 'evt_041')).toBe(false);
  });

  it('409s on re-resolving an already-resolved dispute', async () => {
    await app.inject({
      method: 'PUT', url: '/v1/disputes/disp_001', headers: bearer(ADMIN),
      payload: { status: 'resolved_deleted', resolution: 'first resolution' },
    });
    const again = await app.inject({
      method: 'PUT', url: '/v1/disputes/disp_001', headers: bearer(ADMIN),
      payload: { status: 'resolved_upheld', resolution: 'changed my mind' },
    });
    expect(again.statusCode).toBe(409);
  });

  it('400s resolved_corrected with no correction, through the real schema', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/disputes/disp_002', headers: bearer(ADMIN),
      payload: { status: 'resolved_corrected', resolution: 'no correction supplied' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stamps escalatedAt on read for a seeded, long-overdue dispute', async () => {
    // disp_002, not disp_001 — other tests in this describe block resolve
    // disp_001, and the store is a shared singleton across tests in this file
    // (buildApp() rebuilds the Fastify app, not the underlying Maps), so a
    // resolved dispute here would no longer be eligible for escalation and
    // this assertion would fail for a reason unrelated to escalation itself.
    const res = await app.inject({ method: 'GET', url: '/v1/disputes', headers: bearer(ADMIN) });
    const disp002 = res.json().data.find((d: { id: string }) => d.id === 'disp_002');
    expect(disp002.status).toBe('open'); // still unresolved — precondition for this test
    expect(disp002.escalatedAt).toBeTruthy();
  });

  it('requires admin scope to resolve a dispute', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/v1/disputes/disp_002', headers: bearer('ck_aave_live_xxx'),
      payload: { status: 'resolved_upheld', resolution: 'x' },
    });
    expect(res.statusCode).toBe(403);
  });
});
