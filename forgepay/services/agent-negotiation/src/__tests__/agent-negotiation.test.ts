/**
 * Integration tests for the Agent Negotiation Protocol service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes
 * without binding to a real port.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

const AUTH = { 'x-api-key': 'test-key', 'Content-Type': 'application/json' };

async function makeApp(): Promise<FastifyApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

async function createSession(app: FastifyApp, overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: AUTH,
    payload: {
      buyerAgentId: 'buyer-agent-001',
      sellerAgentId: 'seller-agent-001',
      itemDescription: 'API data package — 1M records',
      suggestedPrice: 500,
      currency: 'USDC',
      ...overrides,
    },
  });
}

describe('Agent Negotiation Protocol', () => {
  let app: FastifyApp;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ── Health ─────────────────────────────────────────────────────────────────

  it('GET /health returns 200 with service metadata', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; service: string }>();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('agent-negotiation');
  });

  // ── POST /v1/sessions ─────────────────────────────────────────────────────

  it('POST /v1/sessions creates a negotiation session', async () => {
    const res = await createSession(app);
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data).toBeDefined();
    expect(body.data['buyerAgentId']).toBe('buyer-agent-001');
    expect(body.data['sellerAgentId']).toBe('seller-agent-001');
    expect(body.data['status']).toBe('negotiating');
    expect(typeof body.data['id']).toBe('string');
    expect(typeof body.data['createdAt']).toBe('string');
  });

  it('POST /v1/sessions returns 400 when buyerAgentId is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/sessions',
      headers: AUTH,
      payload: {
        sellerAgentId: 'seller-agent-001',
        itemDescription: 'Widget',
        suggestedPrice: 100,
        currency: 'USDC',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/sessions returns 400 when suggestedPrice is zero or negative', async () => {
    const res = await createSession(app, { suggestedPrice: 0 });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/sessions returns 400 for unsupported currency', async () => {
    const res = await createSession(app, { currency: 'BTC' });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/sessions ──────────────────────────────────────────────────────

  it('GET /v1/sessions returns list of sessions', async () => {
    await createSession(app);
    const res = await app.inject({ method: 'GET', url: '/v1/sessions', headers: AUTH });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/sessions?buyerAgentId=x filters results', async () => {
    await createSession(app, { buyerAgentId: 'unique-buyer-filter' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions?buyerAgentId=unique-buyer-filter',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ buyerAgentId: string }> }>();
    body.data.forEach((s) => expect(s.buyerAgentId).toBe('unique-buyer-filter'));
  });

  // ── GET /v1/sessions/:id ──────────────────────────────────────────────────

  it('GET /v1/sessions/:id returns session detail', async () => {
    const createRes = await createSession(app);
    const sessionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${sessionId}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string } }>();
    expect(body.data.id).toBe(sessionId);
  });

  it('GET /v1/sessions/:id returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/sessions/nonexistent-session-xyz',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /v1/sessions/:id/messages ────────────────────────────────────────

  it('POST /v1/sessions/:id/messages adds counter-offer message', async () => {
    const createRes = await createSession(app);
    const sessionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/messages`,
      headers: AUTH,
      payload: {
        role: 'counter_offer',
        content: 'Counter offer: $450 for the data package',
        terms: { price: 450, currency: 'USDC', deliveryDays: 2 },
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { role: string; content: string } }>();
    expect(body.data.role).toBe('counter_offer');
  });

  it('POST /v1/sessions/:id/messages returns 400 for invalid role', async () => {
    const createRes = await createSession(app);
    const sessionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/messages`,
      headers: AUTH,
      payload: { role: 'invalid_role', content: 'test' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── POST /v1/sessions/:id/accept ─────────────────────────────────────────

  it('POST /v1/sessions/:id/accept changes status to agreed', async () => {
    const createRes = await createSession(app);
    const sessionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/accept`,
      headers: AUTH,
      payload: { agreedPrice: 500, currency: 'USDC' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string } }>();
    expect(body.data.status).toBe('agreed');
  });

  // ── POST /v1/sessions/:id/reject ─────────────────────────────────────────

  it('POST /v1/sessions/:id/reject changes status to rejected', async () => {
    const createRes = await createSession(app);
    const sessionId = createRes.json<{ data: { id: string } }>().data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/reject`,
      headers: AUTH,
      payload: { reason: 'Price too high' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string } }>();
    expect(body.data.status).toBe('rejected');
  });

  // ── POST /v1/escrow ───────────────────────────────────────────────────────

  it('POST /v1/escrow creates an escrow linked to a session', async () => {
    const createRes = await createSession(app);
    const sessionId = createRes.json<{ data: { id: string } }>().data.id;

    // Accept the session first
    await app.inject({
      method: 'POST',
      url: `/v1/sessions/${sessionId}/accept`,
      headers: AUTH,
      payload: { agreedPrice: 500, currency: 'USDC' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/escrow',
      headers: AUTH,
      payload: {
        sessionId,
        buyerAgentId: 'buyer-agent-001',
        sellerAgentId: 'seller-agent-001',
        amount: 500,
        asset: 'USDC',
        chain: 'base',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { status: string; sessionId: string } }>();
    expect(body.data.status).toBe('pending');
    expect(body.data.sessionId).toBe(sessionId);
  });

  it('POST /v1/escrow returns 400 for unsupported asset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/escrow',
      headers: AUTH,
      payload: {
        sessionId: 'some-session',
        buyerAgentId: 'buyer',
        sellerAgentId: 'seller',
        amount: 100,
        asset: 'BTC',
        chain: 'base',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── Auth enforcement ─────────────────────────────────────────────────────

  it('Requests without X-Api-Key header return 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
    expect(res.statusCode).toBe(401);
  });
});
