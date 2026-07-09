import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

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

describe('Crypto Gateway - Invoice Routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    queryMock.mockReset();
    app = Fastify();
    await app.register(buildInvoiceRoutes, { prefix: '/invoices' });
  });

  describe('POST /invoices', () => {
    it('should create a BTC invoice', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] }); // INSERT
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
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
        rows: [{ id: 'inv_test123', coin: 'BTC', amount_usd: 0.5, status: 'pending' }],
      });
      const res = await app.inject({
        method: 'GET',
        url: '/invoices/inv_test123',
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload).id).toBe('inv_test123');
    });

    it('should return 404 for non-existent invoice', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });
      const res = await app.inject({
        method: 'GET',
        url: '/invoices/non_existent',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
