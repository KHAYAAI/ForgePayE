import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  SubscriptionsResource,
  PlansResource,
  UsageResource,
} from '../src/resources/subscriptions.js';
import type { FPHttpClient } from '../src/client.js';
import type { ListResponse, Plan, Subscription, UsageRecord } from '../src/types.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const SUBSCRIPTION: Subscription = {
  id:                   'sub_xyz789',
  object:               'subscription',
  customer_id:          'cus_123',
  plan_id:              'forgepay-growth-monthly',
  status:               'active',
  current_period_start: 1714000000,
  current_period_end:   1716678400,
  trial_end:            null,
  cancel_at_period_end: false,
  cancelled_at:         null,
  metadata:             {},
  created:              1714000000,
};

const PLAN: Plan = {
  id:                 'forgepay-growth-monthly',
  object:             'plan',
  name:               'Growth Monthly',
  amount:             4900,
  currency:           'USD',
  interval:           'month',
  interval_count:     1,
  trial_period_days:  null,
  active:             true,
  metadata:           {},
};

const USAGE_RECORD: UsageRecord = {
  id:              'ur_001',
  object:          'usage_record',
  subscription_id: 'sub_xyz789',
  quantity:        150_000,
  timestamp:       1714001000,
  action:          'increment',
};

const SUB_LIST: ListResponse<Subscription> = {
  data:     [SUBSCRIPTION],
  count:    1,
  total:    1,
  has_more: false,
};

const PLAN_LIST: ListResponse<Plan> = {
  data:     [PLAN],
  count:    1,
  total:    1,
  has_more: false,
};

const USAGE_LIST: ListResponse<UsageRecord> = {
  data:     [USAGE_RECORD],
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

// ── SubscriptionsResource tests ────────────────────────────────────────────────

describe('SubscriptionsResource', () => {
  let client: ReturnType<typeof makeMockClient>;
  let subscriptions: SubscriptionsResource;

  beforeEach(() => {
    client        = makeMockClient();
    subscriptions = new SubscriptionsResource(client);
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe('create', () => {
    it('calls client.post on /v1/subscriptions with body and idempotency key', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(SUBSCRIPTION);

      const result = await subscriptions.create({
        customer_id:     'cus_123',
        plan_id:         'forgepay-growth-monthly',
        trial_days:      14,
        idempotency_key: 'sub_create_cus_123',
      });

      expect(client.post).toHaveBeenCalledOnce();
      expect(client.post).toHaveBeenCalledWith(
        '/v1/subscriptions',
        { customer_id: 'cus_123', plan_id: 'forgepay-growth-monthly', trial_days: 14 },
        { idempotencyKey: 'sub_create_cus_123' },
      );
      expect(result).toEqual(SUBSCRIPTION);
    });

    it('works without optional fields', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(SUBSCRIPTION);

      await subscriptions.create({ customer_id: 'cus_123', plan_id: 'plan_basic' });

      expect(client.post).toHaveBeenCalledWith(
        '/v1/subscriptions',
        { customer_id: 'cus_123', plan_id: 'plan_basic' },
        { idempotencyKey: undefined },
      );
    });
  });

  // ── retrieve ───────────────────────────────────────────────────────────────

  describe('retrieve', () => {
    it('calls client.get on /v1/subscriptions/:id', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(SUBSCRIPTION);

      const result = await subscriptions.retrieve('sub_xyz789');

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/subscriptions/sub_xyz789');
      expect(result).toEqual(SUBSCRIPTION);
    });
  });

  // ── update ─────────────────────────────────────────────────────────────────

  describe('update', () => {
    it('calls client.patch on /v1/subscriptions/:id with params', async () => {
      const updated = { ...SUBSCRIPTION, cancel_at_period_end: true };
      (client.patch as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const result = await subscriptions.update('sub_xyz789', { cancel_at_period_end: true });

      expect(client.patch).toHaveBeenCalledOnce();
      expect(client.patch).toHaveBeenCalledWith(
        '/v1/subscriptions/sub_xyz789',
        { cancel_at_period_end: true },
      );
      expect(result.cancel_at_period_end).toBe(true);
    });
  });

  // ── cancel ─────────────────────────────────────────────────────────────────

  describe('cancel', () => {
    it('calls client.post on /v1/subscriptions/:id/cancel with at_period_end option', async () => {
      const cancelled = { ...SUBSCRIPTION, status: 'cancelled' } as Subscription;
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(cancelled);

      const result = await subscriptions.cancel('sub_xyz789', { at_period_end: true });

      expect(client.post).toHaveBeenCalledOnce();
      expect(client.post).toHaveBeenCalledWith(
        '/v1/subscriptions/sub_xyz789/cancel',
        { at_period_end: true },
      );
      expect(result.status).toBe('cancelled');
    });

    it('cancels immediately when called without options', async () => {
      const cancelled = { ...SUBSCRIPTION, status: 'cancelled' } as Subscription;
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(cancelled);

      await subscriptions.cancel('sub_xyz789');

      expect(client.post).toHaveBeenCalledWith(
        '/v1/subscriptions/sub_xyz789/cancel',
        undefined,
      );
    });
  });

  // ── pause / resume ─────────────────────────────────────────────────────────

  describe('pause', () => {
    it('calls client.post on /v1/subscriptions/:id/pause', async () => {
      const paused = { ...SUBSCRIPTION, status: 'paused' } as Subscription;
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(paused);

      const result = await subscriptions.pause('sub_xyz789');

      expect(client.post).toHaveBeenCalledWith('/v1/subscriptions/sub_xyz789/pause');
      expect(result.status).toBe('paused');
    });
  });

  describe('resume', () => {
    it('calls client.post on /v1/subscriptions/:id/resume', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(SUBSCRIPTION);

      const result = await subscriptions.resume('sub_xyz789');

      expect(client.post).toHaveBeenCalledWith('/v1/subscriptions/sub_xyz789/resume');
      expect(result).toEqual(SUBSCRIPTION);
    });
  });

  // ── list ───────────────────────────────────────────────────────────────────

  describe('list', () => {
    it('calls client.get on /v1/subscriptions with optional params', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(SUB_LIST);

      const result = await subscriptions.list({ customer_id: 'cus_123', limit: 5 });

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/subscriptions', {
        customer_id: 'cus_123',
        limit:       5,
      });
      expect(result).toEqual(SUB_LIST);
    });

    it('calls client.get with no params when called with no arguments', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(SUB_LIST);

      await subscriptions.list();

      expect(client.get).toHaveBeenCalledWith('/v1/subscriptions', undefined);
    });
  });
});

// ── PlansResource tests ────────────────────────────────────────────────────────

describe('PlansResource', () => {
  let client: ReturnType<typeof makeMockClient>;
  let plans: PlansResource;

  beforeEach(() => {
    client = makeMockClient();
    plans  = new PlansResource(client);
  });

  describe('list', () => {
    it('calls client.get on /v1/plans', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(PLAN_LIST);

      const result = await plans.list();

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/plans');
      expect(result).toEqual(PLAN_LIST);
    });
  });

  describe('retrieve', () => {
    it('calls client.get on /v1/plans/:id', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(PLAN);

      const result = await plans.retrieve('forgepay-growth-monthly');

      expect(client.get).toHaveBeenCalledWith('/v1/plans/forgepay-growth-monthly');
      expect(result).toEqual(PLAN);
    });
  });
});

// ── UsageResource tests ────────────────────────────────────────────────────────

describe('UsageResource', () => {
  let client: ReturnType<typeof makeMockClient>;
  let usage: UsageResource;

  beforeEach(() => {
    client = makeMockClient();
    usage  = new UsageResource(client);
  });

  describe('report', () => {
    it('calls client.post on /v1/subscriptions/:id/usage with quantity and idempotency key', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(USAGE_RECORD);

      const result = await usage.report({
        subscription_id: 'sub_xyz789',
        quantity:        150_000,
        action:          'increment',
        idempotency_key: 'usage_period_job1',
      });

      expect(client.post).toHaveBeenCalledOnce();
      const [path, body, opts] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(path).toBe('/v1/subscriptions/sub_xyz789/usage');
      expect(body.quantity).toBe(150_000);
      expect(body.action).toBe('increment');
      expect(opts).toEqual({ idempotencyKey: 'usage_period_job1' });
      expect(result).toEqual(USAGE_RECORD);
    });

    it('converts a Date timestamp to a Unix integer in seconds', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(USAGE_RECORD);

      const date = new Date('2026-04-25T00:00:00.000Z');
      await usage.report({
        subscription_id: 'sub_xyz789',
        quantity:        1,
        timestamp:       date,
      });

      const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body.timestamp).toBe(Math.floor(date.getTime() / 1000));
    });

    it('passes a numeric timestamp through as-is', async () => {
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(USAGE_RECORD);

      await usage.report({
        subscription_id: 'sub_xyz789',
        quantity:        500,
        timestamp:       1714001000,
      });

      const [, body] = (client.post as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(body.timestamp).toBe(1714001000);
    });
  });

  describe('list', () => {
    it('calls client.get on /v1/subscriptions/:id/usage', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(USAGE_LIST);

      const result = await usage.list('sub_xyz789', { start: 1714000000, end: 1716678400 });

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith(
        '/v1/subscriptions/sub_xyz789/usage',
        { start: 1714000000, end: 1716678400 },
      );
      expect(result).toEqual(USAGE_LIST);
    });

    it('calls without a period when period is omitted', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(USAGE_LIST);

      await usage.list('sub_xyz789');

      expect(client.get).toHaveBeenCalledWith('/v1/subscriptions/sub_xyz789/usage', undefined);
    });
  });
});
