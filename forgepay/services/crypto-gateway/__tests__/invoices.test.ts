import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { registerApiKeyAuth } from '../src/plugins/api-key-auth.js';

// invoices.ts reads the db pool via getDb() (a module-level singleton) and
// fetches live prices via getUsdPrice() — neither is passed in as a
// dependency, so the only way to test the route without a live Postgres and
// a live price API is to mock both modules before importing the route.
const queryMock = vi.fn();
vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({ query: queryMock }),
}));
vi.mock('../src/lib/prices.js', () => ({
  getUsdPrice: vi.fn().mockResolvedValue(50_000),
  usdToCrypto: (usd: number, price: number) => usd / price,
}));
vi.mock('../src/lib/hdwallet.js', () => ({
  deriveBtcAddress: vi.fn().mockResolvedValue('bc1qmockaddressxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
  deriveEthAddress: vi.fn().mockResolvedValue('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
  deriveLtcAddress: vi.fn().mockResolvedValue('ltc1qmockaddressxxxxxxxxxxxxxxxxxxxxxxxxxxx'),
  deriveXmrAddress: vi.fn().mockResolvedValue('4Mock1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRS'),
  nextKeyIndex: vi.fn().mockResolvedValue(0),
}));

const { buildInvoiceRoutes } = await import('../src/routes/invoices.js');

// Any non-empty API key authenticates (as admin) as long as neither
// VALID_API_KEYS nor MERCHANT_API_KEYS is configured — see
// `permissiveDevFallback` in plugins/api-key-auth.ts. Tests that exercise
// ownership configure MERCHANT_API_KEYS/VALID_API_KEYS explicitly instead.
const ANY_KEY = { 'x-api-key': 'any-non-empty-test-key' };

describe('Crypto Gateway - Invoice Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    queryMock.mockReset();
    app = Fastify();
    registerApiKeyAuth(app);
    await app.register(buildInvoiceRoutes, { prefix: '/invoices' });
  });

  describe('POST /invoices', () => {
    it('should create a BTC invoice', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
        headers: ANY_KEY,
        payload: {
          coin: 'BTC',
          amount_usd: 0.5,
          merchant_id: 'test-merchant-123',
          metadata: { order_id: '456' },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('id');
      expect(body).toHaveProperty('address');
      expect(body).toHaveProperty('expires_at');
      expect(body.coin).toBe('BTC');
      expect(body.amount_usd).toBe(0.5);
    });

    it('should create an ETH invoice', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
        headers: ANY_KEY,
        payload: {
          coin: 'ETH',
          amount_usd: 1.5,
          merchant_id: 'test-merchant-123',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body.coin).toBe('ETH');
      expect(body).toHaveProperty('address');
    });

    it('should validate required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
        headers: ANY_KEY,
        payload: {
          coin: 'BTC',
          merchant_id: 'test-merchant-123',
          // amount_usd deliberately omitted — required by the route schema
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it('should reject invalid coin', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
        headers: ANY_KEY,
        payload: {
          coin: 'DOGE',
          amount_usd: 1,
          merchant_id: 'test-merchant-123',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /invoices/:id', () => {
    it('should fetch invoice details', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [{ id: 'inv_test123', merchant_id: 'test-merchant-123', coin: 'BTC', amount_usd: 0.5, status: 'pending' }],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/invoices/inv_test123',
        headers: ANY_KEY,
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).id).toBe('inv_test123');
    });

    it('should return 404 for non-existent invoice', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      const res = await app.inject({
        method: 'GET',
        url: '/invoices/non_existent',
        headers: ANY_KEY,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── Auth enforcement ─────────────────────────────────────────────────────

  it('requests without an API key return 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/invoices/inv_test123' });
    expect(res.statusCode).toBe(401);
  });
});

// ── Per-merchant ownership ───────────────────────────────────────────────────
//
// Regression coverage for the bug where any valid key — with no notion of
// which merchant it belonged to — could read any other merchant's invoice by
// id, or list any merchant's invoices wholesale, by simply supplying that
// merchant's id. MERCHANT_API_KEYS gives each key an identity;
// invoiceAccessError enforces that a non-admin caller may only act on
// invoices belonging to its own merchant_id (403, never 404, on mismatch).

describe('Per-merchant invoice ownership', () => {
  const MERCHANT_A_KEY = 'merchant-a-key-00000000000000000000';
  const MERCHANT_B_KEY = 'merchant-b-key-00000000000000000000';
  const ADMIN_KEY      = 'ownership-admin-key-000000000000000';

  const AUTH_A     = { 'x-api-key': MERCHANT_A_KEY };
  const AUTH_B     = { 'x-api-key': MERCHANT_B_KEY };
  const AUTH_ADMIN = { 'x-api-key': ADMIN_KEY };

  let ownedApp: ReturnType<typeof Fastify>;
  let savedMerchantKeys: string | undefined;
  let savedValidKeys: string | undefined;

  beforeEach(async () => {
    queryMock.mockReset();
    savedMerchantKeys = process.env['MERCHANT_API_KEYS'];
    savedValidKeys = process.env['VALID_API_KEYS'];
    process.env['MERCHANT_API_KEYS'] = `merchant-a:${MERCHANT_A_KEY},merchant-b:${MERCHANT_B_KEY}`;
    process.env['VALID_API_KEYS'] = ADMIN_KEY;

    ownedApp = Fastify();
    registerApiKeyAuth(ownedApp);
    await ownedApp.register(buildInvoiceRoutes, { prefix: '/invoices' });
  });

  afterEach(async () => {
    await ownedApp.close();
    if (savedMerchantKeys === undefined) delete process.env['MERCHANT_API_KEYS']; else process.env['MERCHANT_API_KEYS'] = savedMerchantKeys;
    if (savedValidKeys === undefined) delete process.env['VALID_API_KEYS']; else process.env['VALID_API_KEYS'] = savedValidKeys;
  });

  it('a merchant reading its own invoice succeeds', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'inv_a1', merchant_id: 'merchant-a', coin: 'BTC', status: 'pending' }],
    });
    const res = await ownedApp.inject({ method: 'GET', url: '/invoices/inv_a1', headers: AUTH_A });
    expect(res.statusCode).toBe(200);
  });

  it('a merchant reading another merchant\'s invoice gets 403, not 404', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'inv_a1', merchant_id: 'merchant-a', coin: 'BTC', status: 'pending' }],
    });
    const res = await ownedApp.inject({ method: 'GET', url: '/invoices/inv_a1', headers: AUTH_B });
    expect(res.statusCode).toBe(403);
  });

  it('admin can read any merchant\'s invoice', async () => {
    queryMock.mockResolvedValueOnce({
      rows: [{ id: 'inv_a1', merchant_id: 'merchant-a', coin: 'BTC', status: 'pending' }],
    });
    const res = await ownedApp.inject({ method: 'GET', url: '/invoices/inv_a1', headers: AUTH_ADMIN });
    expect(res.statusCode).toBe(200);
  });

  it('a merchant cannot list another merchant\'s invoices', async () => {
    const res = await ownedApp.inject({
      method: 'GET',
      url: '/invoices?merchant_id=merchant-b',
      headers: AUTH_A,
    });
    expect(res.statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('a merchant can list its own invoices', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });
    const res = await ownedApp.inject({
      method: 'GET',
      url: '/invoices?merchant_id=merchant-a',
      headers: AUTH_A,
    });
    expect(res.statusCode).toBe(200);
  });

  it('a merchant cannot create an invoice claiming to be another merchant', async () => {
    const res = await ownedApp.inject({
      method: 'POST',
      url: '/invoices',
      headers: AUTH_A,
      payload: { coin: 'BTC', amount_usd: 1, merchant_id: 'merchant-b' },
    });
    expect(res.statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('an unknown key is rejected once MERCHANT_API_KEYS/VALID_API_KEYS are configured', async () => {
    const res = await ownedApp.inject({
      method: 'GET',
      url: '/invoices/inv_a1',
      headers: { 'x-api-key': 'totally-unknown-key' },
    });
    expect(res.statusCode).toBe(401);
  });
});
