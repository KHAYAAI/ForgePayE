/**
 * Phase 5 shielded stablecoin gateway tests.
 *
 * All tests run in STUB MODE — no real Groth16 verification, no real ECDH
 * decryption, no live blockchain connection required.
 *
 * Tests verify:
 *   - Correct HTTP responses for happy path
 *   - Double-spend prevention (nullifier uniqueness)
 *   - Privacy: response bodies never contain plaintext amounts
 *   - Graceful error handling (invalid inputs, service unavailability)
 *   - x402-shielded variant works end-to-end
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { buildShieldedDepositRoutes } from '../src/routes/shielded-deposits.js';
import { buildX402Routes } from '../src/routes/x402.js';
import { buildX402ShieldedRoutes } from '../src/routes/x402-shielded.js';

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mockDb = {
  rows: [] as Record<string, unknown>[],
  query: vi.fn(),
};

vi.mock('../src/lib/db.js', () => ({
  getDb: () => mockDb,
}));

vi.mock('../src/lib/events.js', () => ({
  forwardToUnifiedRouter: vi.fn().mockResolvedValue(undefined),
}));

// This suite builds routes directly (no api-key-auth plugin registered, so
// req.auth is always undefined) — it is about shielded-payment privacy
// behaviour, not ownership enforcement, which is covered separately in
// __tests__/ownership.test.ts against a real auth-enabled app. Stub
// merchantAccessError to always authorise so these requests aren't rejected
// for lacking an auth context they were never meant to exercise.
vi.mock('../src/plugins/api-key-auth.js', () => ({
  merchantAccessError: () => null,
}));

// decryptMemoViaAuditor makes a real outbound HTTP call to
// config.shielded.auditorServiceUrl (mor-layer:8010) — unreachable in this
// unit-test environment (no mor-layer running, no network egress). Every
// route under test calls it before doing anything else, so without this
// mock every one of them 502s ("AuditorUnavailable") regardless of what's
// actually being tested. verifyGroth16Proof is left unmocked — it already
// self-stubs to `true` for any chain whose NullifierRegistry isn't deployed
// (see lib/proof-verifier.ts), which is exactly this suite's config.
vi.mock('../src/lib/proof-verifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/proof-verifier.js')>();
  return {
    ...actual,
    decryptMemoViaAuditor: vi.fn().mockResolvedValue({
      amount_units: '4999000000',
      amount_usd:   4999,
    }),
  };
});

vi.mock('../src/config.js', () => ({
  config: {
    port:                   8020,
    paymentExpirySeconds:   3600,
    unifiedRouterUrl:       'http://unified-router:8000',
    internalWebhookSecret:  'test-secret',
    shielded: {
      enabled:              true,
      monitorIntervalMs:    30000,
      auditorServiceUrl:    'http://mor-layer:8010',
      nullifierRegistry: {
        ethereum: '0x0000000000000000000000000000000000000000',
        polygon:  '0x0000000000000000000000000000000000000000',
        base:     '0x0000000000000000000000000000000000000000',
        arbitrum: '0x0000000000000000000000000000000000000000',
      },
    },
    x402: { enabled: true, maxAmountUsdc: 100 },
  },
}));

// ── Test fixtures ─────────────────────────────────────────────────────────────
const VALID_NULLIFIER = '0x' + 'a'.repeat(64);

const validShieldedDepositBody = {
  merchant_id:    'merch_test_001',
  encrypted_memo: Buffer.from(JSON.stringify({ asset: 0, amount: 4999 })).toString('base64'),
  proof_bytes:    Buffer.from('stub_proof_bytes').toString('base64'),
  nullifier:      VALID_NULLIFIER,
  chain:          'base',
  token:          'USDC',
  metadata:       { order_id: 'order_001' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
async function buildTestApp() {
  const app = Fastify({ logger: false });
  // GET /shielded-deposits (list) reads req.auth?.principalId directly
  // (ownership scoping added alongside this service's IDOR fix) rather than
  // going through the merchantAccessError() mock above, which the other
  // routes use. This suite is about shielded-payment privacy behaviour, not
  // ownership enforcement (see the top-of-file comment), so fake an
  // authenticated merchant matching whatever merchant_id the request itself
  // names — equivalent in spirit to merchantAccessError always returning
  // "authorized" — rather than exercise real ownership denial here.
  app.addHook('onRequest', async (req) => {
    const merchantId =
      (req.query as { merchant_id?: string } | undefined)?.merchant_id ??
      (req.body as { merchant_id?: string } | undefined)?.merchant_id ??
      'merch_test_001';
    req.auth = { principalId: merchantId, kind: 'merchant' };
  });
  await app.register(buildShieldedDepositRoutes, { prefix: '/shielded-deposits' });
  await app.register(buildX402Routes,            { prefix: '/x402' });
  // POST /x402/shielded-pay and GET /x402/shielded-verify/:receipt_id live in
  // a separate router file (mirrors src/index.ts, which registers both under
  // the same /x402 prefix) — buildX402Routes alone never mounted them, which
  // is why the "x402-shielded flow" tests below 404'd before this was added.
  await app.register(buildX402ShieldedRoutes,    { prefix: '/x402' });
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /shielded-deposits', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();

    // Default: nullifier not yet spent
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, status FROM shielded_deposits')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO shielded_deposits')) {
        return { rows: [] };
      }
      return { rows: [] };
    });
  });

  it('creates a shielded deposit with 201 status', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   validShieldedDepositBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.nullifier).toBe(VALID_NULLIFIER);
    expect(body.status).toBe('pending');
    expect(body.chain).toBe('base');
    expect(body.token).toBe('USDC');
  });

  it('response MUST NOT contain plaintext amount', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   validShieldedDepositBody,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    // Privacy guarantee: these fields must never appear in the merchant-facing response
    expect(body).not.toHaveProperty('amount_usd');
    expect(body).not.toHaveProperty('amount_units');
    expect(body).not.toHaveProperty('amount');
  });

  it('rejects duplicate nullifier with 409 NullifierAlreadySpent', async () => {
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id, status FROM shielded_deposits')) {
        return { rows: [{ id: 'existing-deposit-id', status: 'confirmed' }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   validShieldedDepositBody,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NullifierAlreadySpent');
  });

  it('rejects missing required fields with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   { merchant_id: 'merch_123' }, // missing encrypted_memo, proof_bytes, etc.
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid nullifier format (not 0x + 64 hex chars)', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   { ...validShieldedDepositBody, nullifier: 'not-a-valid-nullifier' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unsupported chain', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   { ...validShieldedDepositBody, chain: 'solana' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('stores nullifier in DB (double-spend prevention)', async () => {
    await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   validShieldedDepositBody,
    });

    const insertCall = (mockDb.query.mock.calls as [string, unknown[]][]).find(
      ([sql]) => sql.includes('INSERT INTO shielded_deposits'),
    );
    expect(insertCall).toBeDefined();
    // Nullifier must be in the INSERT parameters
    expect(insertCall![1]).toContain(VALID_NULLIFIER);
  });

  it('does NOT store plaintext amount in DB', async () => {
    await app.inject({
      method: 'POST',
      url:    '/shielded-deposits',
      body:   validShieldedDepositBody,
    });

    const insertCall = (mockDb.query.mock.calls as [string, unknown[]][]).find(
      ([sql]) => sql.includes('INSERT INTO shielded_deposits'),
    );
    expect(insertCall).toBeDefined();
    const sql = insertCall![0];
    // amount_usd and amount_units must not appear in the INSERT SQL
    expect(sql).not.toContain('amount_usd');
    expect(sql).not.toContain('amount_units');
  });
});

describe('GET /shielded-deposits/:id', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
  });

  it('returns deposit status without amount', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id:           'deposit-001',
        merchant_id:  'merch_123',
        nullifier:    VALID_NULLIFIER,
        chain:        'base',
        token:        'USDC',
        status:       'confirmed',
        tx_hash:      '0x' + 'b'.repeat(64),
        created_at:   new Date().toISOString(),
        confirmed_at: new Date().toISOString(),
        frozen_reason: null,
      }],
    });

    const res = await app.inject({ method: 'GET', url: '/shielded-deposits/deposit-001' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.status).toBe('confirmed');
    // Privacy: no amount in GET response either
    expect(body).not.toHaveProperty('amount_usd');
    expect(body).not.toHaveProperty('encrypted_memo');
    expect(body).not.toHaveProperty('proof_bytes');
  });

  it('returns 404 for unknown deposit', async () => {
    mockDb.query.mockResolvedValueOnce({ rows: [] });
    const res = await app.inject({ method: 'GET', url: '/shielded-deposits/nonexistent' });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /shielded-deposits (list)', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
    mockDb.query.mockResolvedValue({
      rows: [
        { id: 'dep-1', nullifier: VALID_NULLIFIER, chain: 'base', token: 'USDC', status: 'confirmed', tx_hash: null, created_at: new Date().toISOString(), confirmed_at: null },
      ],
    });
  });

  it('lists deposits without amounts', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/shielded-deposits?merchant_id=merch_123',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: Record<string, unknown>[] };
    expect(body.data).toHaveLength(1);
    // No amounts in list response
    expect(body.data[0]).not.toHaveProperty('amount_usd');
    expect(body.data[0]).not.toHaveProperty('encrypted_memo');
  });

  it('requires merchant_id query param', async () => {
    const res = await app.inject({ method: 'GET', url: '/shielded-deposits' });
    expect(res.statusCode).toBe(400);
  });
});

describe('x402-shielded flow', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildTestApp();
    mockDb.query.mockResolvedValue({ rows: [] });
  });

  it('GET /x402/shielded-payment-required returns 402 with ZK fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/x402/shielded-payment-required?resource=https://api.test.com&merchant_id=merch_123',
    });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.scheme).toBe('x402-shielded');
    expect(body.shielded).toBeDefined();
    expect(body.shielded.auditor_public_key).toBeDefined();
    expect(body.shielded.contract_address).toBeDefined();
    // No amount in the payment required response
    expect(body).not.toHaveProperty('amount');
  });

  it('POST /x402/shielded-pay creates shielded receipt without amount', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/x402/shielded-pay',
      body: {
        resource_url:   'https://api.test.com/data',
        merchant_id:    'merch_123',
        encrypted_memo: Buffer.from('{}').toString('base64'),
        proof_bytes:    Buffer.from('stub').toString('base64'),
        nullifier:      VALID_NULLIFIER,
        chain:          'base',
        agent_id:       'agent_claude_001',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.receipt_id).toBeDefined();
    expect(body.nullifier).toBe(VALID_NULLIFIER);
    expect(body.shielded).toBeUndefined(); // not in create response
    expect(body).not.toHaveProperty('amount_usdc'); // privacy guarantee
  });

  it('GET /x402/shielded-verify returns valid status', async () => {
    mockDb.query.mockResolvedValueOnce({
      rows: [{
        id:          'receipt-001',
        status:      'confirmed',
        chain:       'base',
        resource_url: 'https://api.test.com',
        nullifier:   VALID_NULLIFIER,
        created_at:  new Date().toISOString(),
        expires_at:  new Date(Date.now() + 60_000).toISOString(),
      }],
    });
    const res = await app.inject({ method: 'GET', url: '/x402/shielded-verify/receipt-001' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body.valid).toBe(true);
    expect(body.shielded).toBe(true);
    // No amount in verify response
    expect(body).not.toHaveProperty('amount_usdc');
  });

  it('double-spend via x402-shielded returns 409', async () => {
    mockDb.query.mockImplementation((sql: string) => {
      if (sql.includes('SELECT id FROM x402_shielded_payments')) {
        return { rows: [{ id: 'existing-payment' }] };
      }
      return { rows: [] };
    });

    const res = await app.inject({
      method: 'POST',
      url:    '/x402/shielded-pay',
      body: {
        resource_url:   'https://api.test.com/data',
        merchant_id:    'merch_123',
        encrypted_memo: Buffer.from('{}').toString('base64'),
        proof_bytes:    Buffer.from('stub').toString('base64'),
        nullifier:      VALID_NULLIFIER,
        chain:          'base',
      },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('NullifierAlreadySpent');
  });
});
