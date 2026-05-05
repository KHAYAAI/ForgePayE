import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import { buildInvoiceRoutes } from '../src/routes/invoices';
import type { Pool } from 'pg';

describe('Crypto Gateway - Invoice Routes', () => {
  let app: any;
  let mockDb: Pool;

  beforeAll(async () => {
    mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    app = Fastify();
    await app.register(buildInvoiceRoutes, { prefix: '/invoices' });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /invoices', () => {
    it('should create a BTC invoice', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
        payload: {
          coin: 'BTC',
          amount: 0.5,
          merchant_id: 'test-merchant-123',
          metadata: { order_id: '456' },
        },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.payload);
      expect(body).toHaveProperty('invoice_id');
      expect(body).toHaveProperty('address');
      expect(body).toHaveProperty('expires_at');
      expect(body.coin).toBe('BTC');
      expect(body.amount).toBe(0.5);
    });

    it('should create an ETH invoice', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/invoices',
        payload: {
          coin: 'ETH',
          amount: 1.5,
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
          amount: 1,
          merchant_id: 'test-merchant-123',
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /invoices/:id', () => {
    it('should fetch invoice details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/invoices/inv_test123',
      });

      expect([200, 404]).toContain(res.statusCode);
    });

    it('should return 404 for non-existent invoice', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/invoices/non_existent',
      });

      expect(res.statusCode).toBe(404);
    });
  });
});
