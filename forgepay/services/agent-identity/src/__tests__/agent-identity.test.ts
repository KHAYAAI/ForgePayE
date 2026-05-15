/**
 * Integration tests for the Agent Identity Registry service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes
 * without binding to a real port.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

async function makeApp(): Promise<FastifyApp> {
  const app = await buildApp();
  await app.ready();
  return app;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('Agent Identity Registry', () => {
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
    expect(body.service).toBe('agent-identity');
  });

  // ── POST /v1/agents — Register agent ──────────────────────────────────────

  it('POST /v1/agents registers an agent successfully', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'Test Negotiation Agent',
        framework:       'elizaos',
        ownerMerchantId: 'test_mer_001',
        capabilities:   ['negotiation', 'payment'],
        webhookUrl:      'https://agents.example.com/hook',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: Record<string, unknown> }>();
    expect(body.data).toBeDefined();
    expect(body.data['name']).toBe('Test Negotiation Agent');
    expect(body.data['framework']).toBe('elizaos');
    expect(body.data['ownerMerchantId']).toBe('test_mer_001');
    expect(body.data['capabilities']).toContain('negotiation');
    expect(body.data['reputationScore']).toBe(500);
    expect(body.data['status']).toBe('active');
    expect(typeof body.data['id']).toBe('string');
    expect((body.data['did'] as string).startsWith('did:forgepay:')).toBe(true);
  });

  it('POST /v1/agents with missing name returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        framework:       'elizaos',
        ownerMerchantId: 'test_mer_001',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('POST /v1/agents with missing framework returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'No Framework Agent',
        ownerMerchantId: 'test_mer_001',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string; message: string }>();
    expect(body.error).toBe('ValidationError');
    expect(body.message).toContain('framework');
  });

  it('POST /v1/agents with invalid framework returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'Bad Framework Agent',
        framework:       'unknown_framework',
        ownerMerchantId: 'test_mer_001',
      },
    });

    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/agents with missing ownerMerchantId returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:      'Agent Without Owner',
        framework: 'forgepay',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  // ── GET /v1/agents/:id — Retrieve agent ───────────────────────────────────

  it('GET /v1/agents/:id retrieves a registered agent', async () => {
    // First register an agent
    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'Retrieval Test Agent',
        framework:       'autogen',
        ownerMerchantId: 'test_mer_002',
        capabilities:   ['data_analysis'],
      },
    });
    const created = createRes.json<{ data: { id: string } }>();
    const agentId = created.data.id;

    // Retrieve by ID
    const getRes = await app.inject({ method: 'GET', url: `/v1/agents/${agentId}` });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json<{ data: { id: string; name: string } }>();
    expect(body.data.id).toBe(agentId);
    expect(body.data.name).toBe('Retrieval Test Agent');
  });

  it('GET /v1/agents/:id returns 404 for unknown agent', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents/nonexistent-agent-xyz' });
    expect(res.statusCode).toBe(404);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('NotFound');
  });

  // ── GET /v1/discover — Discover by capability ─────────────────────────────

  it('GET /v1/discover?capability=negotiation returns agents with that capability', async () => {
    // Register an agent with the capability
    await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'Discover Target Agent',
        framework:       'langchain',
        ownerMerchantId: 'test_mer_003',
        capabilities:   ['negotiation', 'yield'],
      },
    });

    const res = await app.inject({ method: 'GET', url: '/v1/discover?capability=negotiation' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ capabilities: string[] }>; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    // Every returned agent should include the requested capability
    body.data.forEach((agent) => {
      expect(agent.capabilities).toContain('negotiation');
    });
  });

  it('GET /v1/discover without capability param returns 400', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/discover' });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('GET /v1/discover?minReputation=50 returns only agents with score >= 50', async () => {
    // Seed agents with reputationScore 500 (default); one of the seed agents
    // has score 820, so at least one should be returned with minReputation=50.
    const res = await app.inject({ method: 'GET', url: '/v1/discover?capability=payment&minReputation=50' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ reputationScore: number }>; total: number }>();
    body.data.forEach((agent) => {
      expect(agent.reputationScore).toBeGreaterThanOrEqual(50);
    });
  });

  // ── POST /v1/agents/:id/reputation — Record reputation event ──────────────

  it('POST /v1/agents/:id/reputation records an event and updates score', async () => {
    // Register a fresh agent
    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'Reputation Test Agent',
        framework:       'crewai',
        ownerMerchantId: 'test_mer_004',
        capabilities:   ['payment'],
      },
    });
    const agent = createRes.json<{ data: { id: string; reputationScore: number } }>().data;
    expect(agent.reputationScore).toBe(500);

    const repRes = await app.inject({
      method:  'POST',
      url:     `/v1/agents/${agent.id}/reputation`,
      payload: {
        eventType:   'transaction_success',
        description: 'Completed API data purchase successfully',
      },
    });

    expect(repRes.statusCode).toBe(201);
    const repBody = repRes.json<{ data: { eventType: string; scoreDelta: number } }>();
    expect(repBody.data.eventType).toBe('transaction_success');
    expect(repBody.data.scoreDelta).toBe(5); // +5 per reputation.ts

    // Verify score increased
    const getRes  = await app.inject({ method: 'GET', url: `/v1/agents/${agent.id}` });
    const updated = getRes.json<{ data: { reputationScore: number } }>().data;
    expect(updated.reputationScore).toBe(505);
  });

  it('POST /v1/agents/:id/reputation with invalid eventType returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/reputation',
      payload: {
        eventType:   'invalid_event',
        description: 'Should fail',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /v1/agents/:id/reputation without description returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/reputation',
      payload: { eventType: 'transaction_success' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/agents/:id/reputation — History ───────────────────────────────

  it('GET /v1/agents/:id/reputation returns reputation event history', async () => {
    // Record an event
    await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/reputation',
      payload: {
        eventType:   'vouched_by_trusted',
        description: 'Vouched by institutional partner',
      },
    });

    const res = await app.inject({ method: 'GET', url: '/v1/agents/treasury-oracle-1/reputation' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ── DELETE /v1/agents/:id — Deregister ───────────────────────────────────

  it('DELETE /v1/agents/:id deregisters an agent and subsequent GET returns 404', async () => {
    // Register a fresh agent to deregister
    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      payload: {
        name:            'To Be Deleted Agent',
        framework:       'custom',
        ownerMerchantId: 'test_mer_005',
        capabilities:   [],
      },
    });
    const agentId = createRes.json<{ data: { id: string } }>().data.id;

    // Deregister
    const delRes = await app.inject({ method: 'DELETE', url: `/v1/agents/${agentId}` });
    expect(delRes.statusCode).toBe(204);

    // Subsequent GET should 404 (deregistered agents are excluded from lookup)
    const getRes = await app.inject({ method: 'GET', url: `/v1/agents/${agentId}` });
    expect(getRes.statusCode).toBe(404);
  });

  it('DELETE /v1/agents/:id for unknown agent returns 404', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/v1/agents/does-not-exist-agent' });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /v1/agents/:id/attestations — Attestations ──────────────────────

  it('POST /v1/agents/:id/attestations adds an attestation', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/attestations',
      payload: {
        claim:            'verified_treasury_operator',
        issuerMerchantId: 'merchant-forgepay-internal',
        data:             { verifiedAt: '2026-05-01' },
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ data: { claim: string; subjectAgentId: string } }>();
    expect(body.data.claim).toBe('verified_treasury_operator');
    expect(body.data.subjectAgentId).toBe('treasury-oracle-1');
  });

  it('GET /v1/agents/:id/attestations returns attestation list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents/treasury-oracle-1/attestations' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
  });

  // ── GET /v1/agents — List with filters ───────────────────────────────────

  it('GET /v1/agents returns paginated agent list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/agents?framework=elizaos filters by framework', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents?framework=elizaos' });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ framework: string }> }>();
    body.data.forEach((agent) => {
      expect(agent.framework).toBe('elizaos');
    });
  });
});
