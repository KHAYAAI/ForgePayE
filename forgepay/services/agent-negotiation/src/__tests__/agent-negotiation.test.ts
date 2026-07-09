/**
 * Integration tests for the Agent Negotiation Protocol service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes without
 * binding to a real port. The apiKeyAuth plugin allows any non-empty
 * key in non-production mode, so all non-health requests carry 'x-api-key'.
 *
 * Escrow-ledger tests use per-test agent ids (rather than the shared
 * 'agent-buyer-1' / 'agent-seller-1' defaults) so that balance assertions
 * don't depend on test execution order — the ledger's in-memory balances
 * persist for the lifetime of the single `app` built in beforeAll.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

const AUTH = { 'x-api-key': 'test-key' };

async function makeApp(): Promise<FastifyApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

/** Creates a standard negotiation session and returns its ID. */
async function createSession(
  app: FastifyApp,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/sessions',
    headers: AUTH,
    payload: {
      initiatorAgentId: 'agent-buyer-1',
      responderAgentId: 'agent-seller-1',
      subject:          'API data access for 30 days',
      initialTerms:    [
        { key: 'price_usd', value: 500, unit: 'USD' },
        { key: 'delivery_sla_hours', value: 24, unit: 'hours' },
      ],
      ...overrides,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createSession failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ data: { id: string } }>().data.id;
}

/** Creates an escrow for the given session and returns the escrow ID. */
async function createEscrow(
  app: FastifyApp,
  sessionId: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const res = await app.inject({
    method:  'POST',
    url:     '/v1/escrow',
    headers: AUTH,
    payload: {
      sessionId,
      buyerAgentId:  'agent-buyer-1',
      sellerAgentId: 'agent-seller-1',
      amountUsd:     500,
      asset:         'USDC',
      chain:         'base',
      ...overrides,
    },
  });
  if (res.statusCode !== 201) {
    throw new Error(`createEscrow failed: ${res.statusCode} ${res.body}`);
  }
  return res.json<{ data: { id: string } }>().data.id;
}

/** Deposits into an agent's internal ledger balance via the admin/test-only endpoint. */
async function depositBalance(app: FastifyApp, agentId: string, amountUsd: number): Promise<void> {
  const res = await app.inject({
    method:  'POST',
    url:     `/v1/agents/${agentId}/balance/deposit`,
    headers: AUTH,
    payload: { amountUsd },
  });
  if (res.statusCode !== 201) {
    throw new Error(`depositBalance failed: ${res.statusCode} ${res.body}`);
  }
}

/** Reads an agent's current ledger balance. */
async function getBalance(app: FastifyApp, agentId: string): Promise<number> {
  const res = await app.inject({ method: 'GET', url: `/v1/agents/${agentId}/balance`, headers: AUTH });
  return res.json<{ data: { balanceUsd: number } }>().data.balanceUsd;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

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

  // ── POST /v1/sessions — Create session ───────────────────────────────────

  it('POST /v1/sessions creates a negotiation session with buyer, seller, item, initial_offer', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/sessions',
      headers: AUTH,
      payload: {
        initiatorAgentId: 'agent-buyer-1',
        responderAgentId: 'agent-seller-1',
        subject:          'Treasury yield sweep service',
        initialTerms:    [
          { key: 'price_usd', value: 1200, unit: 'USD' },
          { key: 'data_format', value: 'json' },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data['initiatorAgentId']).toBe('agent-buyer-1');
    expect(body.data['responderAgentId']).toBe('agent-seller-1');
    expect(body.data['subject']).toBe('Treasury yield sweep service');
    expect(body.data['status']).toBe('active');
    expect(body.data['totalRounds']).toBe(1);
    // First message (the initial offer) should be present
    expect(Array.isArray(body.data['messages'])).toBe(true);
    expect((body.data['messages'] as unknown[]).length).toBe(1);
    expect(typeof body.data['id']).toBe('string');
  });

  it('POST /v1/sessions with missing initiatorAgentId returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/sessions',
      headers: AUTH,
      payload: {
        responderAgentId: 'agent-seller-1',
        subject:          'Missing initiator',
        initialTerms:    [],
      },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('POST /v1/sessions with missing subject returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/sessions',
      headers: AUTH,
      payload: {
        initiatorAgentId: 'agent-buyer-1',
        responderAgentId: 'agent-seller-1',
        initialTerms:    [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/sessions with non-array initialTerms returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/sessions',
      headers: AUTH,
      payload: {
        initiatorAgentId: 'agent-buyer-1',
        responderAgentId: 'agent-seller-1',
        subject:          'Bad terms',
        initialTerms:    'not-an-array',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/sessions/:id — Retrieve session ───────────────────────────────

  it('GET /v1/sessions/:id retrieves session with message history', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'GET',
      url:     `/v1/sessions/${sessionId}`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { id: string; messages: unknown[] } }>();
    expect(body.data.id).toBe(sessionId);
    expect(Array.isArray(body.data.messages)).toBe(true);
    expect(body.data.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /v1/sessions/:id for unknown session returns 404', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/sessions/nonexistent-session-id',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /v1/sessions/:id/messages — Add messages ─────────────────────────

  it('POST /v1/sessions/:id/messages adds an offer message', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/messages`,
      headers: AUTH,
      payload: {
        fromAgentId: 'agent-seller-1',
        role:        'offer',
        terms:       [{ key: 'price_usd', value: 450, unit: 'USD' }],
        message:     'Seller counter proposal',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      data: { message: { role: string }; session: { totalRounds: number } };
    }>();
    expect(body.data.message.role).toBe('offer');
    expect(body.data.session.totalRounds).toBe(2);
  });

  it('POST /v1/sessions/:id/messages adds a counter_offer message', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/messages`,
      headers: AUTH,
      payload: {
        fromAgentId: 'agent-buyer-1',
        role:        'counter_offer',
        terms:       [
          { key: 'price_usd', value: 480, unit: 'USD' },
          { key: 'delivery_sla_hours', value: 12, unit: 'hours' },
        ],
        message: 'Higher price for faster delivery',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      data: { message: { role: string }; session: { status: string } };
    }>();
    expect(body.data.message.role).toBe('counter_offer');
    expect(body.data.session.status).toBe('active');
  });

  it('POST /v1/sessions/:id/messages with invalid role returns 400', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/messages`,
      headers: AUTH,
      payload: {
        fromAgentId: 'agent-buyer-1',
        role:        'invalid_role',
        terms:       [],
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/sessions/:id/messages from non-participant returns 422', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/messages`,
      headers: AUTH,
      payload: {
        fromAgentId: 'outsider-agent-999',
        role:        'offer',
        terms:       [],
      },
    });
    expect(res.statusCode).toBe(422);
  });

  // ── POST /v1/sessions/:id/accept — Accept shortcut ───────────────────────

  it('POST /v1/sessions/:id/accept marks session as accepted', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/accept`,
      headers: AUTH,
      payload: {
        fromAgentId: 'agent-seller-1',
        message:     'Accepting the initial terms',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string; agreedTerms: unknown[] } }>();
    expect(body.data.status).toBe('accepted');
    expect(Array.isArray(body.data.agreedTerms)).toBe(true);
  });

  // ── POST /v1/sessions/:id/reject — Reject shortcut ───────────────────────

  it('POST /v1/sessions/:id/reject marks session as rejected', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/reject`,
      headers: AUTH,
      payload: {
        fromAgentId: 'agent-seller-1',
        reason:      'Price out of budget range',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string } }>();
    expect(body.data.status).toBe('rejected');
  });

  // ── GET /v1/sessions/:id/agreed-terms ─────────────────────────────────────

  it('GET /v1/sessions/:id/agreed-terms after accept returns the agreed terms', async () => {
    const sessionId = await createSession(app);

    // Accept the session first
    await app.inject({
      method:  'POST',
      url:     `/v1/sessions/${sessionId}/accept`,
      headers: AUTH,
      payload: { fromAgentId: 'agent-seller-1' },
    });

    const res = await app.inject({
      method:  'GET',
      url:     `/v1/sessions/${sessionId}/agreed-terms`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[] }>();
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/sessions/:id/agreed-terms on active (non-accepted) session returns 422', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'GET',
      url:     `/v1/sessions/${sessionId}/agreed-terms`,
      headers: AUTH,
    });
    expect(res.statusCode).toBe(422);
  });

  // ── POST /v1/escrow — Create escrow ──────────────────────────────────────

  it('POST /v1/escrow creates an escrow linked to a session', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     '/v1/escrow',
      headers: AUTH,
      payload: {
        sessionId,
        buyerAgentId:  'agent-buyer-1',
        sellerAgentId: 'agent-seller-1',
        amountUsd:     500,
        asset:         'USDC',
        chain:         'base',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      data: {
        id:            string;
        sessionId:     string;
        status:        string;
        amountUsd:     number;
        asset:         string;
        chain:         string;
      };
    }>();
    expect(body.data.sessionId).toBe(sessionId);
    expect(body.data.status).toBe('pending');
    expect(body.data.amountUsd).toBe(500);
    expect(body.data.asset).toBe('USDC');
    expect(body.data.chain).toBe('base');
    expect(typeof body.data.id).toBe('string');
  });

  it('POST /v1/escrow with invalid asset returns 400', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     '/v1/escrow',
      headers: AUTH,
      payload: {
        sessionId,
        buyerAgentId:  'agent-buyer-1',
        sellerAgentId: 'agent-seller-1',
        amountUsd:     500,
        asset:         'BTC',
        chain:         'base',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/escrow with invalid chain returns 400', async () => {
    const sessionId = await createSession(app);

    const res = await app.inject({
      method:  'POST',
      url:     '/v1/escrow',
      headers: AUTH,
      payload: {
        sessionId,
        buyerAgentId:  'agent-buyer-1',
        sellerAgentId: 'agent-seller-1',
        amountUsd:     500,
        asset:         'USDC',
        chain:         'solana',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/escrow for non-existent session returns 404', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/escrow',
      headers: AUTH,
      payload: {
        sessionId:     'nonexistent-session-id',
        buyerAgentId:  'agent-buyer-1',
        sellerAgentId: 'agent-seller-1',
        amountUsd:     500,
        asset:         'USDC',
        chain:         'base',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /v1/escrow/:id/fund ──────────────────────────────────────────────

  it('POST /v1/escrow/:id/fund debits the buyer ledger balance and marks the escrow funded', async () => {
    const buyer      = 'agent-buyer-fund-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, {
      buyerAgentId: buyer, amountUsd: 750, asset: 'USDT', chain: 'ethereum',
    });

    await depositBalance(app, buyer, 1000);

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/escrow/${escrowId}/fund`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string; fundedAt: string } }>();
    expect(body.data.status).toBe('funded');
    expect(typeof body.data.fundedAt).toBe('string');
    expect(await getBalance(app, buyer)).toBe(250); // 1000 deposited - 750 locked
  });

  it('POST /v1/escrow/:id/fund rejects with a clean error when the buyer balance is insufficient', async () => {
    const buyer      = 'agent-buyer-poor-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, { buyerAgentId: buyer, amountUsd: 500 });

    // No deposit made — buyer balance is 0.
    const res = await app.inject({
      method:  'POST',
      url:     `/v1/escrow/${escrowId}/fund`,
      headers: AUTH,
    });

    expect(res.statusCode).toBe(422);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('EscrowError');
    expect(body.message).toMatch(/insufficient balance/i);

    // Balance must not have gone negative or been mutated.
    expect(await getBalance(app, buyer)).toBe(0);

    // The escrow itself must remain 'pending' — the lock never happened.
    const escrowRes = await app.inject({ method: 'GET', url: `/v1/escrow/${escrowId}`, headers: AUTH });
    expect(escrowRes.json<{ data: { status: string } }>().data.status).toBe('pending');
  });

  // ── POST /v1/escrow/:id/release ───────────────────────────────────────────

  it('POST /v1/escrow/:id/release releases escrow to seller and credits the seller ledger', async () => {
    const buyer      = 'agent-buyer-release-1';
    const seller     = 'agent-seller-release-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, {
      buyerAgentId: buyer, sellerAgentId: seller, amountUsd: 1000, chain: 'polygon',
    });

    await depositBalance(app, buyer, 1000);
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/fund`, headers: AUTH });

    const releaseRes = await app.inject({
      method:  'POST',
      url:     `/v1/escrow/${escrowId}/release`,
      headers: AUTH,
      payload: { settlementTxId: 'tx_release_001' },
    });

    expect(releaseRes.statusCode).toBe(200);
    const body = releaseRes.json<{ data: { status: string; releasedAt: string } }>();
    expect(body.data.status).toBe('released');
    expect(typeof body.data.releasedAt).toBe('string');

    expect(await getBalance(app, buyer)).toBe(0);    // locked away, never returned
    expect(await getBalance(app, seller)).toBe(1000); // credited on release
  });

  it('POST /v1/escrow/:id/release on un-funded escrow returns 422', async () => {
    const sessionId = await createSession(app);
    const escrowId  = await createEscrow(app, sessionId, { amountUsd: 300 });

    // Include an empty payload so req.body is not null when the handler accesses it
    const res = await app.inject({
      method:  'POST',
      url:     `/v1/escrow/${escrowId}/release`,
      headers: AUTH,
      payload: {},
    });
    expect(res.statusCode).toBe(422);
  });

  it('POST /v1/escrow/:id/release twice (double-release) fails cleanly on the second call', async () => {
    const buyer      = 'agent-buyer-double-release-1';
    const seller     = 'agent-seller-double-release-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, { buyerAgentId: buyer, sellerAgentId: seller, amountUsd: 400 });

    await depositBalance(app, buyer, 400);
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/fund`, headers: AUTH });

    const first = await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/release`, headers: AUTH, payload: {} });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/release`, headers: AUTH, payload: {} });
    expect(second.statusCode).toBe(422);
    expect(second.json<{ error: string }>().error).toBe('EscrowError');

    // Seller must only have been paid once, not twice.
    expect(await getBalance(app, seller)).toBe(400);
  });

  it('POST /v1/escrow/:id/release after a refund fails cleanly (no double-pay)', async () => {
    const buyer      = 'agent-buyer-release-after-refund-1';
    const seller     = 'agent-seller-release-after-refund-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, { buyerAgentId: buyer, sellerAgentId: seller, amountUsd: 150 });

    await depositBalance(app, buyer, 150);
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/fund`, headers: AUTH });
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/refund`, headers: AUTH, payload: {} });

    const releaseAfterRefund = await app.inject({
      method: 'POST', url: `/v1/escrow/${escrowId}/release`, headers: AUTH, payload: {},
    });
    expect(releaseAfterRefund.statusCode).toBe(422);

    // Buyer got the refund; seller must never be paid.
    expect(await getBalance(app, buyer)).toBe(150);
    expect(await getBalance(app, seller)).toBe(0);
  });

  // ── POST /v1/escrow/:id/refund ────────────────────────────────────────────

  it('POST /v1/escrow/:id/refund refunds escrow to buyer and credits the buyer ledger', async () => {
    const buyer      = 'agent-buyer-refund-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, { buyerAgentId: buyer, amountUsd: 200, asset: 'USDT' });

    await depositBalance(app, buyer, 200);
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/fund`, headers: AUTH });
    expect(await getBalance(app, buyer)).toBe(0);

    const refundRes = await app.inject({
      method:  'POST',
      url:     `/v1/escrow/${escrowId}/refund`,
      headers: AUTH,
      payload: { reason: 'Seller failed to deliver' },
    });

    expect(refundRes.statusCode).toBe(200);
    const body = refundRes.json<{ data: { status: string } }>();
    expect(body.data.status).toBe('refunded');
    expect(await getBalance(app, buyer)).toBe(200); // restored in full
  });

  it('POST /v1/escrow/:id/refund twice (double-refund) fails cleanly on the second call', async () => {
    const buyer      = 'agent-buyer-double-refund-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, { buyerAgentId: buyer, amountUsd: 90 });

    await depositBalance(app, buyer, 90);
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/fund`, headers: AUTH });

    const first = await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/refund`, headers: AUTH, payload: {} });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/refund`, headers: AUTH, payload: {} });
    expect(second.statusCode).toBe(422);
    expect(second.json<{ error: string }>().error).toBe('EscrowError');

    // Buyer must only have been refunded once, not twice.
    expect(await getBalance(app, buyer)).toBe(90);
  });

  it('POST /v1/escrow/:id/refund after a release fails cleanly (no double-pay)', async () => {
    const buyer      = 'agent-buyer-refund-after-release-1';
    const seller     = 'agent-seller-refund-after-release-1';
    const sessionId  = await createSession(app, { initiatorAgentId: buyer });
    const escrowId   = await createEscrow(app, sessionId, { buyerAgentId: buyer, sellerAgentId: seller, amountUsd: 60 });

    await depositBalance(app, buyer, 60);
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/fund`, headers: AUTH });
    await app.inject({ method: 'POST', url: `/v1/escrow/${escrowId}/release`, headers: AUTH, payload: {} });

    const refundAfterRelease = await app.inject({
      method: 'POST', url: `/v1/escrow/${escrowId}/refund`, headers: AUTH, payload: {},
    });
    expect(refundAfterRelease.statusCode).toBe(422);

    // Seller got paid; buyer must never be refunded on top of that.
    expect(await getBalance(app, seller)).toBe(60);
    expect(await getBalance(app, buyer)).toBe(0);
  });

  // ── Escrow ledger — deposit & audit trail ─────────────────────────────────

  it('POST /v1/agents/:agentId/balance/deposit credits balance and GET reflects it plus an audit trail', async () => {
    const agentId = 'agent-ledger-audit-1';

    const depositRes = await app.inject({
      method:  'POST',
      url:     `/v1/agents/${agentId}/balance/deposit`,
      headers: AUTH,
      payload: { amountUsd: 42.5 },
    });
    expect(depositRes.statusCode).toBe(201);
    const depositBody = depositRes.json<{ data: { agentId: string; balanceUsd: number } }>();
    expect(depositBody.data.agentId).toBe(agentId);
    expect(depositBody.data.balanceUsd).toBe(42.5);

    const balanceRes = await app.inject({ method: 'GET', url: `/v1/agents/${agentId}/balance`, headers: AUTH });
    expect(balanceRes.statusCode).toBe(200);
    const balanceBody = balanceRes.json<{
      data: { agentId: string; balanceUsd: number; ledger: Array<{ action: string; amountUsd: number; toAgentId: string | null }> };
    }>();
    expect(balanceBody.data.balanceUsd).toBe(42.5);
    expect(balanceBody.data.ledger.length).toBeGreaterThanOrEqual(1);
    expect(balanceBody.data.ledger[0]?.action).toBe('deposit');
    expect(balanceBody.data.ledger[0]?.amountUsd).toBe(42.5);
    expect(balanceBody.data.ledger[0]?.toAgentId).toBe(agentId);
  });

  it('POST /v1/agents/:agentId/balance/deposit with a non-positive amount returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     `/v1/agents/agent-ledger-bad-1/balance/deposit`,
      headers: AUTH,
      payload: { amountUsd: -5 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('ValidationError');
  });

  // ── POST /v1/escrow/:id/dispute ───────────────────────────────────────────

  it('POST /v1/escrow/:id/dispute opens a dispute', async () => {
    const sessionId = await createSession(app);
    const escrowId  = await createEscrow(app, sessionId, { amountUsd: 800 });

    const res = await app.inject({
      method:  'POST',
      url:     `/v1/escrow/${escrowId}/dispute`,
      headers: AUTH,
      payload: { reason: 'Data quality does not match agreed spec' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: { status: string; disputeReason: string } }>();
    expect(body.data.status).toBe('disputed');
    expect(body.data.disputeReason).toBe('Data quality does not match agreed spec');
  });

  // ── GET /v1/sessions — List sessions ─────────────────────────────────────

  it('GET /v1/sessions returns sessions list', async () => {
    await createSession(app);

    const res = await app.inject({
      method:  'GET',
      url:     '/v1/sessions',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ── Auth enforcement ─────────────────────────────────────────────────────

  it('Requests without X-Api-Key return 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/sessions' });
    expect(res.statusCode).toBe(401);
  });
});
