import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PaymentsResource } from '../src/resources/payments.js';
import type { FPHttpClient } from '../src/client.js';
import type { ListResponse, Payment, Refund } from '../src/types.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const PAYMENT: Payment = {
  id:                  'pay_abc123',
  object:              'payment',
  amount:              4900,
  currency:            'USD',
  status:              'created',
  payment_method_type: 'card',
  customer_id:         'cus_123',
  description:         null,
  client_secret:       'cs_test_secret',
  metadata:            {},
  created:             1714000000,
};

const REFUND: Refund = {
  id:         'ref_xyz',
  object:     'refund',
  payment_id: 'pay_abc123',
  amount:     4900,
  currency:   'USD',
  status:     'pending',
  reason:     null,
  created:    1714000100,
};

const LIST_RESPONSE: ListResponse<Payment> = {
  data:     [PAYMENT],
  count:    1,
  total:    1,
  has_more: false,
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeMockClient() {
  return {
    get:    vi.fn(),
    post:   vi.fn(),
    patch:  vi.fn(),
    delete: vi.fn(),
  } as unknown as FPHttpClient;
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('PaymentsResource', () => {
  let client: ReturnType<typeof makeMockClient>;
  let payments: PaymentsResource;

  beforeEach(() => {
    client   = makeMockClient();
    payments = new PaymentsResource(client);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('calls client.post on /v1/payments with the body (minus idempotency_key)', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(PAYMENT);

      const result = await payments.create({
        amount:          4900,
        currency:        'USD',
        customer_id:     'cus_123',
        idempotency_key: 'order_abc_001',
      });

      expect(client.post).toHaveBeenCalledOnce();
      expect(client.post).toHaveBeenCalledWith(
        '/v1/payments',
        { amount: 4900, currency: 'USD', customer_id: 'cus_123' },
        { idempotencyKey: 'order_abc_001' },
      );
      expect(result).toEqual(PAYMENT);
    });

    it('works without an idempotency_key', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(PAYMENT);

      await payments.create({ amount: 100, currency: 'EUR' });

      expect(client.post).toHaveBeenCalledWith(
        '/v1/payments',
        { amount: 100, currency: 'EUR' },
        { idempotencyKey: undefined },
      );
    });
  });

  // ── retrieve ───────────────────────────────────────────────────────────────

  describe('retrieve', () => {
    it('calls client.get on /v1/payments/:id', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(PAYMENT);

      const result = await payments.retrieve('pay_abc123');

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/payments/pay_abc123');
      expect(result).toEqual(PAYMENT);
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('calls client.get on /v1/payments with query params', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(LIST_RESPONSE);

      const result = await payments.list({ limit: 10 });

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/payments', { limit: 10 });
      expect(result).toEqual(LIST_RESPONSE);
    });

    it('calls client.get with no params when called with no arguments', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(LIST_RESPONSE);

      await payments.list();

      expect(client.get).toHaveBeenCalledWith('/v1/payments', undefined);
    });

    it('forwards all supported filter params', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(LIST_RESPONSE);

      await payments.list({
        limit:       20,
        cursor:      'cur_next',
        customer_id: 'cus_123',
        status:      'succeeded',
        created_gte: 1_700_000_000,
        created_lte: 1_714_000_000,
      });

      expect(client.get).toHaveBeenCalledWith('/v1/payments', {
        limit:       20,
        cursor:      'cur_next',
        customer_id: 'cus_123',
        status:      'succeeded',
        created_gte: 1_700_000_000,
        created_lte: 1_714_000_000,
      });
    });
  });

  // ── cancel ─────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('calls client.post on /v1/payments/:id/cancel with reason', async () => {
      const cancelled = { ...PAYMENT, status: 'cancelled' } as Payment;
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(cancelled);

      const result = await payments.cancel('pay_abc123', 'requested_by_customer');

      expect(client.post).toHaveBeenCalledOnce();
      expect(client.post).toHaveBeenCalledWith(
        '/v1/payments/pay_abc123/cancel',
        { reason: 'requested_by_customer' },
      );
      expect(result.status).toBe('cancelled');
    });

    it('passes undefined reason when none is provided', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ ...PAYMENT, status: 'cancelled' });

      await payments.cancel('pay_abc123');

      expect(client.post).toHaveBeenCalledWith(
        '/v1/payments/pay_abc123/cancel',
        { reason: undefined },
      );
    });
  });

  // ── refund ─────────────────────────────────────────────────────────────────

  describe('refund', () => {
    it('calls client.post on /v1/payments/:id/refund with body (minus payment_id)', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(REFUND);

      const result = await payments.refund({
        payment_id: 'pay_abc123',
        amount:     1000,
        reason:     'requested_by_customer',
      });

      expect(client.post).toHaveBeenCalledOnce();
      expect(client.post).toHaveBeenCalledWith(
        '/v1/payments/pay_abc123/refund',
        { amount: 1000, reason: 'requested_by_customer' },
      );
      expect(result).toEqual(REFUND);
    });

    it('supports a full refund with only payment_id', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(REFUND);

      await payments.refund({ payment_id: 'pay_abc123' });

      expect(client.post).toHaveBeenCalledWith(
        '/v1/payments/pay_abc123/refund',
        {},
      );
    });
  });
});
