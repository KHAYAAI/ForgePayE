import { createHmac } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksResource } from '../src/resources/webhooks.js';
import type { FPHttpClient } from '../src/client.js';
import type { ListResponse, WebhookEndpoint } from '../src/types.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'whsec_test_supersecret_value_1234567890abcdef';

const EVENT_PAYLOAD = JSON.stringify({
  id:   'evt_001',
  type: 'payment.succeeded',
  data: { id: 'pay_abc123', amount: 4900, currency: 'USD', status: 'succeeded' },
});

function sign(payload: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(Buffer.from(payload)).digest('hex');
}

const VALID_SIG = sign(EVENT_PAYLOAD, WEBHOOK_SECRET);

const ENDPOINT: WebhookEndpoint = {
  id:             'whe_001',
  object:         'webhook_endpoint',
  url:            'https://example.com/webhooks',
  enabled_events: ['payment.succeeded', 'subscription.created'],
  status:         'enabled',
  created:        1714000000,
};

const ENDPOINT_LIST: ListResponse<WebhookEndpoint> = {
  data:     [ENDPOINT],
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

// ── WebhooksResource — instance methods ───────────────────────────────────────

describe('WebhooksResource — instance methods', () => {
  let client: ReturnType<typeof makeMockClient>;
  let webhooks: WebhooksResource;

  beforeEach(() => {
    client   = makeMockClient();
    webhooks = new WebhooksResource(client);
  });

  describe('create', () => {
    it('calls client.post on /v1/webhooks with endpoint params', async () => {
      const response = { ...ENDPOINT, secret: 'whsec_returned_on_create' };
      (client.post as ReturnType<typeof vi.fn>).mockResolvedValue(response);

      const result = await webhooks.create({
        url:            'https://example.com/webhooks',
        enabled_events: ['payment.succeeded'],
      });

      expect(client.post).toHaveBeenCalledOnce();
      expect(client.post).toHaveBeenCalledWith('/v1/webhooks', {
        url:            'https://example.com/webhooks',
        enabled_events: ['payment.succeeded'],
      });
      expect(result.secret).toBe('whsec_returned_on_create');
    });
  });

  describe('retrieve', () => {
    it('calls client.get on /v1/webhooks/:id', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(ENDPOINT);

      const result = await webhooks.retrieve('whe_001');

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/webhooks/whe_001');
      expect(result).toEqual(ENDPOINT);
    });
  });

  describe('list', () => {
    it('calls client.get on /v1/webhooks', async () => {
      (client.get as ReturnType<typeof vi.fn>).mockResolvedValue(ENDPOINT_LIST);

      const result = await webhooks.list();

      expect(client.get).toHaveBeenCalledOnce();
      expect(client.get).toHaveBeenCalledWith('/v1/webhooks');
      expect(result).toEqual(ENDPOINT_LIST);
    });
  });

  describe('update', () => {
    it('calls client.patch on /v1/webhooks/:id with params', async () => {
      const updated = { ...ENDPOINT, status: 'disabled' } as WebhookEndpoint;
      (client.patch as ReturnType<typeof vi.fn>).mockResolvedValue(updated);

      const result = await webhooks.update('whe_001', { disabled: true });

      expect(client.patch).toHaveBeenCalledOnce();
      expect(client.patch).toHaveBeenCalledWith('/v1/webhooks/whe_001', { disabled: true });
      expect(result.status).toBe('disabled');
    });
  });

  describe('delete', () => {
    it('calls client.delete on /v1/webhooks/:id', async () => {
      (client.delete as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'whe_001', deleted: true });

      const result = await webhooks.delete('whe_001');

      expect(client.delete).toHaveBeenCalledOnce();
      expect(client.delete).toHaveBeenCalledWith('/v1/webhooks/whe_001');
      expect(result).toEqual({ id: 'whe_001', deleted: true });
    });
  });
});

// ── WebhooksResource.constructEvent — static method ───────────────────────────

describe('WebhooksResource.constructEvent', () => {
  it('returns the parsed event when the signature is valid (string payload)', () => {
    const event = WebhooksResource.constructEvent(EVENT_PAYLOAD, VALID_SIG, WEBHOOK_SECRET);

    expect(event.type).toBe('payment.succeeded');
    expect(event.id).toBe('evt_001');
    expect(event.data).toMatchObject({ id: 'pay_abc123', amount: 4900 });
  });

  it('returns the parsed event when the signature is valid (Buffer payload)', () => {
    const buf   = Buffer.from(EVENT_PAYLOAD);
    const event = WebhooksResource.constructEvent(buf, VALID_SIG, WEBHOOK_SECRET);

    expect(event.type).toBe('payment.succeeded');
    expect(event.id).toBe('evt_001');
  });

  it('accepts signatures without the sha256= prefix', () => {
    const rawHex = createHmac('sha256', WEBHOOK_SECRET).update(Buffer.from(EVENT_PAYLOAD)).digest('hex');

    const event = WebhooksResource.constructEvent(EVENT_PAYLOAD, rawHex, WEBHOOK_SECRET);
    expect(event.type).toBe('payment.succeeded');
  });

  it('throws when the signature is wrong', () => {
    const badSig = 'sha256=' + 'a'.repeat(64);

    expect(() =>
      WebhooksResource.constructEvent(EVENT_PAYLOAD, badSig, WEBHOOK_SECRET),
    ).toThrow('ForgePay: webhook signature verification failed');
  });

  it('throws when the signature is completely invalid', () => {
    expect(() =>
      WebhooksResource.constructEvent(EVENT_PAYLOAD, 'not_a_valid_sig', WEBHOOK_SECRET),
    ).toThrow('ForgePay: webhook signature verification failed');
  });

  it('throws when the payload has been tampered with', () => {
    const tamperedPayload = EVENT_PAYLOAD.replace('payment.succeeded', 'payment.failed');

    expect(() =>
      WebhooksResource.constructEvent(tamperedPayload, VALID_SIG, WEBHOOK_SECRET),
    ).toThrow('ForgePay: webhook signature verification failed');
  });

  it('throws when the secret is empty', () => {
    expect(() =>
      WebhooksResource.constructEvent(EVENT_PAYLOAD, VALID_SIG, ''),
    ).toThrow('ForgePay: webhook secret is required to verify events');
  });

  it('returns all expected event fields', () => {
    const event = WebhooksResource.constructEvent(EVENT_PAYLOAD, VALID_SIG, WEBHOOK_SECRET);

    expect(event).toHaveProperty('id');
    expect(event).toHaveProperty('type');
    expect(event).toHaveProperty('data');
  });
});
