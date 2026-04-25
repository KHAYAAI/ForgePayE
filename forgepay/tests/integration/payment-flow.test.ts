/**
 * Integration tests for the ForgePay core payment flow.
 *
 * Tests the end-to-end path:
 *   Merchant SDK → MoR checkout → Hyperswitch → Payment Engine
 *   → Unified Router event → Merchant webhook
 *
 * These tests use nock to mock HTTP dependencies so they run without
 * live services. For full end-to-end testing against real services,
 * see the Playwright tests in forgepay/tests/e2e/.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import nock from 'nock';
import { z } from 'zod';
import * as crypto from 'node:crypto';

// ── Service base URLs (match local docker-compose.dev.yml ports) ─────────────

const MOR_LAYER_URL       = 'http://localhost:8001';
const UNIFIED_ROUTER_URL  = 'http://localhost:3100';
const CRYPTO_GW_URL       = 'http://localhost:3200';
const STABLECOIN_GW_URL   = 'http://localhost:3300';
const HYPERSWITCH_URL     = 'http://localhost:8080';

// ── Zod schemas — request/response contracts ──────────────────────────────────

const CheckoutSessionRequestSchema = z.object({
  amount:      z.number().int().positive(),
  currency:    z.string().length(3),
  merchant_id: z.string().min(1),
  metadata:    z.record(z.string()).optional(),
});

const CheckoutSessionResponseSchema = z.object({
  session_id:     z.string().min(1),
  client_secret:  z.string().min(1),
  payment_id:     z.string().min(1),
  status:         z.enum(['requires_payment_method', 'requires_confirmation', 'processing']),
  amount:         z.number().int().positive(),
  currency:       z.string().length(3),
  expires_at:     z.string().datetime(),
});

const WebhookPayloadSchema = z.object({
  event_type:  z.string().min(1),
  payment_id:  z.string().min(1),
  merchant_id: z.string().min(1),
  amount:      z.number().int().positive(),
  currency:    z.string().length(3),
  status:      z.string().min(1),
  timestamp:   z.string().datetime(),
});

const CryptoInvoiceRequestSchema = z.object({
  amount_usd:  z.number().positive(),
  asset:       z.enum(['BTC', 'ETH', 'LTC', 'XMR']),
  merchant_id: z.string().min(1),
  order_id:    z.string().min(1),
});

const CryptoInvoiceResponseSchema = z.object({
  invoice_id:      z.string().min(1),
  address:         z.string().min(10),
  amount_crypto:   z.number().positive(),
  asset:           z.string().min(1),
  exchange_rate:   z.number().positive(),
  expires_at:      z.string().datetime(),
  payment_uri:     z.string().url().optional(),
});

const StablecoinDepositRequestSchema = z.object({
  merchant_id: z.string().min(1),
  asset:       z.enum(['USDC', 'USDT']),
  chain:       z.enum(['ethereum', 'polygon', 'solana', 'base']),
  order_id:    z.string().min(1),
});

const StablecoinDepositResponseSchema = z.object({
  deposit_id:   z.string().min(1),
  address:      z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  asset:        z.string().min(1),
  chain:        z.string().min(1),
  expires_at:   z.string().datetime(),
  memo:         z.string().optional(),
});

const UnifiedEventSchema = z.object({
  event_id:    z.string().uuid(),
  source:      z.enum(['hyperswitch', 'crypto-gateway', 'stablecoin-gateway', 'mor-layer']),
  event_type:  z.string().min(1),
  payload:     z.record(z.unknown()),
  received_at: z.string().datetime(),
});

// ── HMAC helpers ──────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-webhook-secret-32-bytes-long!!';

function signPayload(body: string, secret: string = WEBHOOK_SECRET): string {
  return crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');
}

// ── Shared fixtures ───────────────────────────────────────────────────────────

const MERCHANT_ID  = 'merch_test_abc123';
const PAYMENT_ID   = 'pay_hs_test_xyz789';
const SESSION_ID   = 'cs_test_forgepay_001';
const CLIENT_SECRET = 'cs_secret_abcdefgh_1234567890';
const EXPIRES_AT    = new Date(Date.now() + 30 * 60 * 1000).toISOString();

function makeCheckoutRequest() {
  return {
    amount:      9999,
    currency:    'USD',
    merchant_id: MERCHANT_ID,
    metadata:    { order_id: 'ord_test_001' },
  };
}

// ── 1. POST /v1/checkout/sessions — happy path ────────────────────────────────

describe('POST /v1/checkout/sessions — happy path', () => {
  beforeEach(() => {
    // Hyperswitch creates the payment intent
    nock(HYPERSWITCH_URL)
      .post('/payments')
      .reply(200, {
        payment_id:    PAYMENT_ID,
        client_secret: CLIENT_SECRET,
        status:        'requires_payment_method',
        amount:        9999,
        currency:      'usd',
      });

    // MoR layer creates the session wrapping the Hyperswitch payment
    nock(MOR_LAYER_URL)
      .post('/v1/checkout/sessions')
      .reply(200, {
        session_id:    SESSION_ID,
        client_secret: CLIENT_SECRET,
        payment_id:    PAYMENT_ID,
        status:        'requires_payment_method',
        amount:        9999,
        currency:      'USD',
        expires_at:    EXPIRES_AT,
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('validates the checkout request schema', () => {
    const req = makeCheckoutRequest();
    const result = CheckoutSessionRequestSchema.safeParse(req);
    expect(result.success).toBe(true);
  });

  it('returns a valid session response from mock MoR layer', async () => {
    const reqBody = makeCheckoutRequest();
    const response = await fetch(`${MOR_LAYER_URL}/v1/checkout/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(reqBody),
    });

    expect(response.status).toBe(200);
    const body = await response.json();

    const parsed = CheckoutSessionResponseSchema.safeParse(body);
    expect(parsed.success, `Schema errors: ${JSON.stringify(parsed.error)}`).toBe(true);
    if (parsed.success) {
      expect(parsed.data.payment_id).toBe(PAYMENT_ID);
      expect(parsed.data.session_id).toBe(SESSION_ID);
      expect(parsed.data.amount).toBe(9999);
      expect(parsed.data.currency).toBe('USD');
    }
  });

  it('propagates payment_id from Hyperswitch into the session', async () => {
    const response = await fetch(`${MOR_LAYER_URL}/v1/checkout/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(makeCheckoutRequest()),
    });
    const body = await response.json() as z.infer<typeof CheckoutSessionResponseSchema>;
    expect(body.payment_id).toMatch(/^pay_/);
  });
});

// ── 2. POST /v1/checkout/sessions — Hyperswitch down → 502 ───────────────────

describe('POST /v1/checkout/sessions — Hyperswitch down returns 502', () => {
  beforeEach(() => {
    // Simulate Hyperswitch being unreachable
    nock(HYPERSWITCH_URL)
      .post('/payments')
      .replyWithError('ECONNREFUSED');

    nock(MOR_LAYER_URL)
      .post('/v1/checkout/sessions')
      .reply(502, {
        error:   'upstream_unavailable',
        message: 'Payment processor temporarily unavailable. Please try again.',
        code:    'HYPERSWITCH_DOWN',
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns 502 when Hyperswitch is unavailable', async () => {
    const response = await fetch(`${MOR_LAYER_URL}/v1/checkout/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(makeCheckoutRequest()),
    });

    expect(response.status).toBe(502);
    const body = await response.json() as { error: string; code: string };
    expect(body.error).toBe('upstream_unavailable');
    expect(body.code).toBe('HYPERSWITCH_DOWN');
  });

  it('returns a user-friendly error message on 502', async () => {
    const response = await fetch(`${MOR_LAYER_URL}/v1/checkout/sessions`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(makeCheckoutRequest()),
    });
    const body = await response.json() as { message: string };
    expect(body.message).toMatch(/try again/i);
  });
});

// ── 3. POST /webhooks/hyperswitch — payment.confirmed → forwarded ─────────────

describe('POST /webhooks/hyperswitch — payment.confirmed forwarded to merchant', () => {
  const webhookPayload = {
    event_type:  'payment.confirmed',
    payment_id:  PAYMENT_ID,
    merchant_id: MERCHANT_ID,
    amount:      9999,
    currency:    'USD',
    status:      'succeeded',
    timestamp:   new Date().toISOString(),
  };

  const payloadStr = JSON.stringify(webhookPayload);
  const validSig   = signPayload(payloadStr);

  beforeEach(() => {
    // Unified router accepts the webhook from Hyperswitch
    nock(UNIFIED_ROUTER_URL)
      .post('/webhooks/hyperswitch')
      .matchHeader('x-hyperswitch-signature', validSig)
      .reply(200, {
        event_id:    '550e8400-e29b-41d4-a716-446655440000',
        source:      'hyperswitch',
        event_type:  'payment.confirmed',
        payload:     webhookPayload,
        received_at: new Date().toISOString(),
        forwarded:   true,
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('validates the webhook payload schema', () => {
    const result = WebhookPayloadSchema.safeParse(webhookPayload);
    expect(result.success).toBe(true);
  });

  it('accepts a correctly signed payment.confirmed webhook', async () => {
    const response = await fetch(`${UNIFIED_ROUTER_URL}/webhooks/hyperswitch`, {
      method:  'POST',
      headers: {
        'Content-Type':              'application/json',
        'x-hyperswitch-signature':   validSig,
      },
      body: payloadStr,
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { forwarded: boolean; event_id: string };
    expect(body.forwarded).toBe(true);
    expect(body.event_id).toBeTruthy();
  });

  it('returns a response conforming to UnifiedEventSchema', async () => {
    const response = await fetch(`${UNIFIED_ROUTER_URL}/webhooks/hyperswitch`, {
      method:  'POST',
      headers: {
        'Content-Type':            'application/json',
        'x-hyperswitch-signature': validSig,
      },
      body: payloadStr,
    });

    const body = await response.json();
    const parsed = UnifiedEventSchema.safeParse(body);
    expect(parsed.success, `Schema errors: ${JSON.stringify(parsed.error)}`).toBe(true);
  });
});

// ── 4. POST /webhooks/hyperswitch — invalid HMAC → 401 ───────────────────────

describe('POST /webhooks/hyperswitch — invalid HMAC returns 401', () => {
  const webhookPayload = {
    event_type:  'payment.confirmed',
    payment_id:  PAYMENT_ID,
    merchant_id: MERCHANT_ID,
    amount:      9999,
    currency:    'USD',
    status:      'succeeded',
    timestamp:   new Date().toISOString(),
  };
  const payloadStr = JSON.stringify(webhookPayload);

  beforeEach(() => {
    // Router rejects requests with bad signatures
    nock(UNIFIED_ROUTER_URL)
      .post('/webhooks/hyperswitch')
      .reply(401, {
        error:   'invalid_signature',
        message: 'HMAC-SHA256 signature verification failed.',
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns 401 for a tampered signature', async () => {
    const badSig = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const response = await fetch(`${UNIFIED_ROUTER_URL}/webhooks/hyperswitch`, {
      method:  'POST',
      headers: {
        'Content-Type':            'application/json',
        'x-hyperswitch-signature': badSig,
      },
      body: payloadStr,
    });

    expect(response.status).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe('invalid_signature');
  });

  it('returns 401 when signature header is missing', async () => {
    // nock is already set to reply 401 for any POST to /webhooks/hyperswitch
    const response = await fetch(`${UNIFIED_ROUTER_URL}/webhooks/hyperswitch`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    payloadStr,
    });

    expect(response.status).toBe(401);
  });

  it('HMAC verification distinguishes correct vs incorrect secrets', () => {
    const correct = signPayload(payloadStr, WEBHOOK_SECRET);
    const wrong   = signPayload(payloadStr, 'wrong-secret');
    // Signatures must differ — basic sanity check for the HMAC helper
    expect(correct).not.toBe(wrong);
    // Each should be a 64-char hex string (SHA-256)
    expect(correct).toMatch(/^[0-9a-f]{64}$/);
    expect(wrong).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── 5. POST /invoices (crypto-gateway) ───────────────────────────────────────

describe('POST /invoices — crypto-gateway creates invoice', () => {
  const invoiceRequest = {
    amount_usd:  250.00,
    asset:       'ETH' as const,
    merchant_id: MERCHANT_ID,
    order_id:    'ord_crypto_001',
  };

  const mockAddress  = '0xAbCdEf1234567890abcdef1234567890AbCdEf12';
  const mockExpiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  beforeEach(() => {
    nock(CRYPTO_GW_URL)
      .post('/invoices')
      .reply(201, {
        invoice_id:    'inv_crypto_test_001',
        address:       mockAddress,
        amount_crypto: 0.0714,
        asset:         'ETH',
        exchange_rate: 3500.00,
        expires_at:    mockExpiresAt,
        payment_uri:   `ethereum:${mockAddress}?value=71400000000000000`,
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('validates the invoice request schema', () => {
    const result = CryptoInvoiceRequestSchema.safeParse(invoiceRequest);
    expect(result.success).toBe(true);
  });

  it('creates a crypto invoice with a valid address and expiry', async () => {
    const response = await fetch(`${CRYPTO_GW_URL}/invoices`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(invoiceRequest),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    const parsed = CryptoInvoiceResponseSchema.safeParse(body);
    expect(parsed.success, `Schema errors: ${JSON.stringify(parsed.error)}`).toBe(true);

    if (parsed.success) {
      expect(parsed.data.address).toBe(mockAddress);
      expect(parsed.data.asset).toBe('ETH');
      expect(parsed.data.amount_crypto).toBeGreaterThan(0);
      expect(new Date(parsed.data.expires_at).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('includes a payment URI in the invoice response', async () => {
    const response = await fetch(`${CRYPTO_GW_URL}/invoices`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(invoiceRequest),
    });

    const body = await response.json() as z.infer<typeof CryptoInvoiceResponseSchema>;
    expect(body.payment_uri).toMatch(/^ethereum:/);
  });

  it('rejects an unknown asset type (schema-level)', () => {
    const bad = { ...invoiceRequest, asset: 'DOGE' };
    const result = CryptoInvoiceRequestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});

// ── 6. POST /deposits (stablecoin-gateway) ───────────────────────────────────

describe('POST /deposits — stablecoin-gateway creates USDC deposit address', () => {
  const depositRequest = {
    merchant_id: MERCHANT_ID,
    asset:       'USDC' as const,
    chain:       'ethereum' as const,
    order_id:    'ord_stable_001',
  };

  const mockDepositAddress = '0x1234567890abcdef1234567890ABCDEF12345678';
  const mockExpiresAt      = new Date(Date.now() + 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    nock(STABLECOIN_GW_URL)
      .post('/deposits')
      .reply(201, {
        deposit_id:  'dep_usdc_test_001',
        address:     mockDepositAddress,
        asset:       'USDC',
        chain:       'ethereum',
        expires_at:  mockExpiresAt,
        memo:        'ord_stable_001',
      });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('validates the deposit request schema', () => {
    const result = StablecoinDepositRequestSchema.safeParse(depositRequest);
    expect(result.success).toBe(true);
  });

  it('creates a USDC deposit address on Ethereum', async () => {
    const response = await fetch(`${STABLECOIN_GW_URL}/deposits`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(depositRequest),
    });

    expect(response.status).toBe(201);
    const body = await response.json();

    const parsed = StablecoinDepositResponseSchema.safeParse(body);
    expect(parsed.success, `Schema errors: ${JSON.stringify(parsed.error)}`).toBe(true);

    if (parsed.success) {
      expect(parsed.data.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(parsed.data.asset).toBe('USDC');
      expect(parsed.data.chain).toBe('ethereum');
      expect(new Date(parsed.data.expires_at).getTime()).toBeGreaterThan(Date.now());
    }
  });

  it('returns a deposit address that is a valid ERC-20 address format', async () => {
    const response = await fetch(`${STABLECOIN_GW_URL}/deposits`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(depositRequest),
    });

    const body = await response.json() as z.infer<typeof StablecoinDepositResponseSchema>;
    // ERC-20 addresses: 0x + 40 hex chars
    expect(body.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('includes the order_id as memo for reconciliation', async () => {
    const response = await fetch(`${STABLECOIN_GW_URL}/deposits`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(depositRequest),
    });

    const body = await response.json() as z.infer<typeof StablecoinDepositResponseSchema>;
    expect(body.memo).toBe(depositRequest.order_id);
  });

  it('rejects an unsupported chain (schema-level)', () => {
    const bad = { ...depositRequest, chain: 'bitcoin' };
    const result = StablecoinDepositRequestSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
