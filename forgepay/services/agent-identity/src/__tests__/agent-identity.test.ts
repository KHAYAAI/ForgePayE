/**
 * Integration tests for the Agent Identity Registry service.
 *
 * Uses Fastify's built-in app.inject() to exercise HTTP routes
 * without binding to a real port. The apiKeyAuth plugin allows any
 * non-empty key in non-production mode, so we include a test key header
 * on all non-health requests.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../index';

// ── Helpers ───────────────────────────────────────────────────────────────────

type FastifyApp = Awaited<ReturnType<typeof buildApp>>;

/** Default headers with an API key for non-health routes. */
const AUTH = { 'x-api-key': 'test-key' };

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
      headers: AUTH,
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
    // Canonical form. `did:forgepay:` is still accepted on read for rows
    // written before the change, but is no longer minted.
    expect((body.data['did'] as string).startsWith('did:forge:agent_')).toBe(true);
  });

  it('POST /v1/agents with missing name returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH,
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
      headers: AUTH,
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
      headers: AUTH,
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
      headers: AUTH,
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
    // Register a fresh agent
    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH,
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
    const getRes = await app.inject({
      method:  'GET',
      url:     `/v1/agents/${agentId}`,
      headers: AUTH,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json<{ data: { id: string; name: string } }>();
    expect(body.data.id).toBe(agentId);
    expect(body.data.name).toBe('Retrieval Test Agent');
  });

  it('GET /v1/agents/:id returns 404 for unknown agent', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/agents/nonexistent-agent-xyz',
      headers: AUTH,
    });
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
      headers: AUTH,
      payload: {
        name:            'Discover Target Agent',
        framework:       'langchain',
        ownerMerchantId: 'test_mer_003',
        capabilities:   ['negotiation', 'yield'],
      },
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/v1/discover?capability=negotiation',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ capabilities: string[] }>; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    body.data.forEach((agent) => {
      expect(agent.capabilities).toContain('negotiation');
    });
  });

  it('GET /v1/discover without capability param returns 400', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/discover',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json<{ error: string }>();
    expect(body.error).toBe('ValidationError');
  });

  it('GET /v1/discover?minReputation=50 returns only agents with score >= 50', async () => {
    // The seed agents and newly registered agents all have score >= 500 by default.
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/discover?capability=payment&minReputation=50',
      headers: AUTH,
    });
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
      headers: AUTH,
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
      headers: AUTH,
      payload: {
        eventType:   'transaction_success',
        description: 'Completed API data purchase successfully',
      },
    });

    expect(repRes.statusCode).toBe(201);
    const repBody = repRes.json<{ data: { eventType: string; scoreDelta: number } }>();
    expect(repBody.data.eventType).toBe('transaction_success');
    expect(repBody.data.scoreDelta).toBe(5); // +5 per reputation.ts score table

    // Verify score increased on the agent
    const getRes  = await app.inject({
      method:  'GET',
      url:     `/v1/agents/${agent.id}`,
      headers: AUTH,
    });
    const updated = getRes.json<{ data: { reputationScore: number } }>().data;
    expect(updated.reputationScore).toBe(505);
  });

  it('POST /v1/agents/:id/reputation with invalid eventType returns 400', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/reputation',
      headers: AUTH,
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
      headers: AUTH,
      payload: { eventType: 'transaction_success' },
    });
    expect(res.statusCode).toBe(400);
  });

  // ── GET /v1/agents/:id/reputation — History ───────────────────────────────

  it('GET /v1/agents/:id/reputation returns reputation event history', async () => {
    // Record an event first to ensure history is non-empty
    await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/reputation',
      headers: AUTH,
      payload: {
        eventType:   'vouched_by_trusted',
        description: 'Vouched by institutional partner',
      },
    });

    const res = await app.inject({
      method:  'GET',
      url:     '/v1/agents/treasury-oracle-1/reputation',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ── DELETE /v1/agents/:id — Deregister ───────────────────────────────────

  it('DELETE /v1/agents/:id deregisters an agent', async () => {
    // Register a fresh agent to deregister
    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH,
      payload: {
        name:            'To Be Deleted Agent',
        framework:       'custom',
        ownerMerchantId: 'test_mer_005',
        capabilities:   [],
      },
    });
    const agentId = createRes.json<{ data: { id: string } }>().data.id;

    const delRes = await app.inject({
      method:  'DELETE',
      url:     `/v1/agents/${agentId}`,
      headers: AUTH,
    });
    expect(delRes.statusCode).toBe(204);
  });

  it('GET /v1/agents/:id after deletion returns 200 with deregistered status', async () => {
    // Register and immediately deregister
    const createRes = await app.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH,
      payload: {
        name:            'Another Deleted Agent',
        framework:       'swarms',
        ownerMerchantId: 'test_mer_006',
        capabilities:   [],
      },
    });
    const agentId = createRes.json<{ data: { id: string } }>().data.id;

    await app.inject({
      method:  'DELETE',
      url:     `/v1/agents/${agentId}`,
      headers: AUTH,
    });

    // GET /v1/agents/:id still returns the agent (with status=deregistered),
    // since getAgent looks up directly by ID regardless of status.
    // Deregistered agents are excluded from list/discover results but remain retrievable by ID.
    const getRes = await app.inject({
      method:  'GET',
      url:     `/v1/agents/${agentId}`,
      headers: AUTH,
    });
    expect(getRes.statusCode).toBe(200);
    const body = getRes.json<{ data: { status: string } }>();
    expect(body.data.status).toBe('deregistered');
  });

  it('DELETE /v1/agents/:id for unknown agent returns 404', async () => {
    const res = await app.inject({
      method:  'DELETE',
      url:     '/v1/agents/does-not-exist-agent',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(404);
  });

  // ── POST /v1/agents/:id/attestations — Attestations ──────────────────────

  it('POST /v1/agents/:id/attestations adds an attestation', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/v1/agents/treasury-oracle-1/attestations',
      headers: AUTH,
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
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/agents/treasury-oracle-1/attestations',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
  });

  // ── GET /v1/agents — List with filters ───────────────────────────────────

  it('GET /v1/agents returns paginated agent list', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/agents',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: unknown[]; total: number }>();
    expect(body.total).toBeGreaterThan(0);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it('GET /v1/agents?framework=elizaos filters by framework', async () => {
    const res = await app.inject({
      method:  'GET',
      url:     '/v1/agents?framework=elizaos',
      headers: AUTH,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Array<{ framework: string }> }>();
    body.data.forEach((agent) => {
      expect(agent.framework).toBe('elizaos');
    });
  });

  // ── Auth enforcement ─────────────────────────────────────────────────────

  it('Requests without X-Api-Key return 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(res.statusCode).toBe(401);
  });
});

// ── Production auth: fail closed, not open ───────────────────────────────────
//
// Regression coverage for the bug where VALID_API_KEYS unset in production
// silently accepted any non-empty key (validKeys.size > 0 was false, so the
// whole guard collapsed to "accept anything"). The service must now refuse
// to boot instead. Also regression coverage for reading the wrong env var
// (API_KEYS instead of VALID_API_KEYS, which is what forgepay/infra/vault
// actually provisions) — buildApp() now consumes VALID_API_KEYS.

describe('Production auth fails closed', () => {
  const ENV_KEYS = ['NODE_ENV', 'VALID_API_KEYS', 'MERCHANT_API_KEYS'] as const;
  let saved: Record<string, string | undefined>;

  beforeAll(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('refuses to boot in production when VALID_API_KEYS is not configured', async () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['VALID_API_KEYS'];
    delete process.env['MERCHANT_API_KEYS'];

    await expect(buildApp()).rejects.toThrow(/VALID_API_KEYS is not set/);
  });

  it('refuses to boot in production when VALID_API_KEYS is the dev placeholder', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'dev-identity-key';

    await expect(buildApp()).rejects.toThrow(/development placeholder/);
  });

  it('refuses to boot in production when a configured key is too short', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'short-key';

    await expect(buildApp()).rejects.toThrow(/at least 32 characters/);
  });

  it('boots in production with a sufficiently long VALID_API_KEYS', async () => {
    process.env['NODE_ENV'] = 'production';
    process.env['VALID_API_KEYS'] = 'a'.repeat(40);

    const prodApp = await buildApp();
    await prodApp.ready();
    await prodApp.close();
  });
});

// ── Per-resource ownership ────────────────────────────────────────────────────
//
// Regression coverage for the bug where any valid key — with no notion of
// which merchant it belonged to — could read or mutate any other merchant's
// agent identity, reputation, or attestation record. MERCHANT_API_KEYS gives
// each key an identity (AgentIdentity.ownerMerchantId); agentAccessError
// enforces that a non-admin caller may only act on agents it owns (403,
// never 404, on mismatch). VALID_API_KEYS holders act as admin and bypass
// ownership entirely (matching what cross-service callers like
// agent-decision-framework's AGENT_IDENTITY_API_KEY are expected to hold).

describe('Per-resource ownership', () => {
  const MERCHANT_A_KEY = 'merchant-a-key-00000000000000000000000';
  const MERCHANT_B_KEY = 'merchant-b-key-00000000000000000000000';
  const ADMIN_KEY      = 'ownership-admin-key-0000000000000000000';

  const AUTH_A     = { 'x-api-key': MERCHANT_A_KEY };
  const AUTH_B     = { 'x-api-key': MERCHANT_B_KEY };
  const AUTH_ADMIN = { 'x-api-key': ADMIN_KEY };

  let ownershipApp: FastifyApp;
  let savedMerchantKeys: string | undefined;
  let savedValidKeys: string | undefined;
  let agentAId: string;

  beforeAll(async () => {
    savedMerchantKeys = process.env['MERCHANT_API_KEYS'];
    savedValidKeys = process.env['VALID_API_KEYS'];
    process.env['MERCHANT_API_KEYS'] = `merchant-a:${MERCHANT_A_KEY},merchant-b:${MERCHANT_B_KEY}`;
    process.env['VALID_API_KEYS'] = ADMIN_KEY;

    ownershipApp = await buildApp();
    await ownershipApp.ready();

    const createRes = await ownershipApp.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH_A,
      payload: {
        name:            'Merchant A Owned Agent',
        framework:       'forgepay',
        ownerMerchantId: 'merchant-a',
        capabilities:    ['payment'],
      },
    });
    expect(createRes.statusCode).toBe(201);
    agentAId = createRes.json<{ data: { id: string } }>().data.id;
  });

  afterAll(async () => {
    await ownershipApp.close();
    if (savedMerchantKeys === undefined) delete process.env['MERCHANT_API_KEYS']; else process.env['MERCHANT_API_KEYS'] = savedMerchantKeys;
    if (savedValidKeys === undefined) delete process.env['VALID_API_KEYS']; else process.env['VALID_API_KEYS'] = savedValidKeys;
  });

  it('cannot register an agent claiming an ownerMerchantId the key does not hold', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH_A,
      payload: {
        name:            'Forged Owner Agent',
        framework:       'forgepay',
        ownerMerchantId: 'merchant-b', // merchant-a's key claiming merchant-b
        capabilities:    [],
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin may register an agent on behalf of any merchant', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     '/v1/agents',
      headers: AUTH_ADMIN,
      payload: {
        name:            'Admin Provisioned Agent',
        framework:       'forgepay',
        ownerMerchantId: 'merchant-b',
        capabilities:    [],
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it('the owning merchant can read its own agent', async () => {
    const res = await ownershipApp.inject({ method: 'GET', url: `/v1/agents/${agentAId}`, headers: AUTH_A });
    expect(res.statusCode).toBe(200);
  });

  it('a different merchant reading another merchant\'s agent gets 403, not 404', async () => {
    const res = await ownershipApp.inject({ method: 'GET', url: `/v1/agents/${agentAId}`, headers: AUTH_B });
    expect(res.statusCode).toBe(403);
  });

  it('admin can read any merchant\'s agent', async () => {
    const res = await ownershipApp.inject({ method: 'GET', url: `/v1/agents/${agentAId}`, headers: AUTH_ADMIN });
    expect(res.statusCode).toBe(200);
  });

  it('a different merchant cannot update another merchant\'s agent', async () => {
    const res = await ownershipApp.inject({
      method:  'PUT',
      url:     `/v1/agents/${agentAId}`,
      headers: AUTH_B,
      payload: { name: 'Hijacked Name' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a different merchant cannot deregister another merchant\'s agent', async () => {
    const res = await ownershipApp.inject({ method: 'DELETE', url: `/v1/agents/${agentAId}`, headers: AUTH_B });
    expect(res.statusCode).toBe(403);
  });

  it('a different merchant cannot post a reputation event for another merchant\'s agent', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     `/v1/agents/${agentAId}/reputation`,
      headers: AUTH_B,
      payload: { eventType: 'transaction_success', description: 'Forged event' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('the owning merchant can post a reputation event for its own agent', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     `/v1/agents/${agentAId}/reputation`,
      headers: AUTH_A,
      payload: { eventType: 'transaction_success', description: 'Legitimate event' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('a different merchant cannot read another merchant\'s reputation history', async () => {
    const res = await ownershipApp.inject({
      method:  'GET',
      url:     `/v1/agents/${agentAId}/reputation`,
      headers: AUTH_B,
    });
    expect(res.statusCode).toBe(403);
  });

  it('a different merchant cannot add an attestation to another merchant\'s agent', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     `/v1/agents/${agentAId}/attestations`,
      headers: AUTH_B,
      payload: { claim: 'forged_claim', issuerMerchantId: 'merchant-b' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('a different merchant cannot read another merchant\'s attestations', async () => {
    const res = await ownershipApp.inject({
      method:  'GET',
      url:     `/v1/agents/${agentAId}/attestations`,
      headers: AUTH_B,
    });
    expect(res.statusCode).toBe(403);
  });

  it('a different merchant cannot issue a KYAPay token for another merchant\'s agent', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     `/v1/agents/${agentAId}/kyapay-token`,
      headers: AUTH_B,
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('the owning merchant can issue a KYAPay token for its own agent', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     `/v1/agents/${agentAId}/kyapay-token`,
      headers: AUTH_A,
      payload: {},
    });
    expect(res.statusCode).toBe(200);
  });

  it('admin can act on any merchant\'s agent (attestation write example)', async () => {
    const res = await ownershipApp.inject({
      method:  'POST',
      url:     `/v1/agents/${agentAId}/attestations`,
      headers: AUTH_ADMIN,
      payload: { claim: 'admin_added_claim', issuerMerchantId: 'forgepay-internal' },
    });
    expect(res.statusCode).toBe(201);
  });
});
