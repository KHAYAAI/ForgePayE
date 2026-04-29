import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StablecoinsResource } from '../src/resources/stablecoins.js';

function makeClient() {
  return {
    get:  vi.fn(),
    post: vi.fn(),
    del:  vi.fn(),
  };
}

const MOCK_PAYMENT = {
  id:             'sc_01HXYZSTABLE',
  amount:         '49.00',
  currency:       'USDC',
  chain:          'base',
  status:         'created',
  wallet_address: '0xAbCd1234...',
  customer_id:    'cus_abc',
  expires_at:     '2026-05-01T00:00:00Z',
};

describe('StablecoinsResource', () => {
  let client: ReturnType<typeof makeClient>;
  let stablecoins: StablecoinsResource;

  beforeEach(() => {
    client     = makeClient();
    stablecoins = new StablecoinsResource(client as any);
  });

  describe('create', () => {
    it('calls POST /v1/stablecoins with body and idempotency key', async () => {
      client.post.mockResolvedValue(MOCK_PAYMENT);

      const result = await stablecoins.create({
        amount:          '49.00',
        currency:        'USDC',
        chain:           'base',
        customer_id:     'cus_abc',
        idempotency_key: 'order_xyz_usdc',
      });

      expect(client.post).toHaveBeenCalledWith(
        '/v1/stablecoins',
        { amount: '49.00', currency: 'USDC', chain: 'base', customer_id: 'cus_abc' },
        { idempotencyKey: 'order_xyz_usdc' },
      );
      expect(result.wallet_address).toBe('0xAbCd1234...');
    });

    it('returns the stablecoin payment from the API', async () => {
      client.post.mockResolvedValue(MOCK_PAYMENT);
      const result = await stablecoins.create({
        amount: '10.00', currency: 'USDT', chain: 'ethereum', customer_id: 'cus_x',
        idempotency_key: 'k1',
      });
      expect(result.id).toBe('sc_01HXYZSTABLE');
      expect(result.status).toBe('created');
    });
  });

  describe('retrieve', () => {
    it('calls GET /v1/stablecoins/:id', async () => {
      client.get.mockResolvedValue({ ...MOCK_PAYMENT, status: 'confirmed' });
      const result = await stablecoins.retrieve('sc_01HXYZSTABLE');
      expect(client.get).toHaveBeenCalledWith('/v1/stablecoins/sc_01HXYZSTABLE');
      expect(result.status).toBe('confirmed');
    });
  });

  describe('list', () => {
    it('calls GET /v1/stablecoins with no params', async () => {
      client.get.mockResolvedValue({ data: [MOCK_PAYMENT], has_more: false });
      await stablecoins.list();
      expect(client.get).toHaveBeenCalledWith('/v1/stablecoins', undefined);
    });

    it('passes filter params to GET', async () => {
      client.get.mockResolvedValue({ data: [], has_more: false });
      await stablecoins.list({ currency: 'USDC', chain: 'base', limit: 10 });
      expect(client.get).toHaveBeenCalledWith('/v1/stablecoins', {
        currency: 'USDC', chain: 'base', limit: 10,
      });
    });
  });
});
