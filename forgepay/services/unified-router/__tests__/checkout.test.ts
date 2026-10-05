/**
 * routes/checkout.ts — logic tests with every external dependency mocked
 * (Kill Bill, Hyperswitch, stablecoin-gateway aren't running in CI or this
 * sandbox). Verifies the branches that matter: free tier provisions
 * immediately, standard requires a payment method, an unknown tier is
 * rejected before anything is charged, a declined card is reported (not
 * hidden), and a stalled/unconfirmed x402 payment reports 'pending', never
 * a silent hang or a false success.
 *
 * The real network-call path (billing-engine unreachable in this sandbox)
 * was verified separately by actually running the service against a real
 * local Postgres — see the session transcript. This file covers what a live
 * dependency can't: the decision logic itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

vi.mock('../src/lib/killbill-client.js', () => ({
  createAccount: vi.fn(async () => ({ accountId: 'kb_acct_test' })),
  createSubscription: vi.fn(async () => ({ subscriptionId: 'kb_sub_test' })),
  addHyperswitchPaymentMethod: vi.fn(async () => ({ paymentMethodId: 'kb_pm_test' })),
}));
vi.mock('../src/lib/hyperswitch-client.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/hyperswitch-client.js')>('../src/lib/hyperswitch-client.js');
  return {
    ...actual,
    createPaymentIntent: vi.fn(),
    getPayment: vi.fn(),
  };
});
vi.mock('../src/lib/stablecoin-client.js', () => ({
  requestX402Payment: vi.fn(),
  verifyX402Payment: vi.fn(),
}));

const dbRows: Record<string, unknown>[] = [];
vi.mock('../src/db/index.js', () => ({
  db: {
    query: vi.fn(async (_tenant: string, sql: string, params: unknown[] = []) => {
      if (sql.startsWith('INSERT INTO checkout_sessions')) {
        const [email, business_name, tier_id, monthly_fee_cents, payment_method, expires_at] = params as string[];
        const row = {
          id: `sess_${dbRows.length + 1}`,
          email, business_name, tier_id,
          monthly_fee_cents: Number(monthly_fee_cents),
          payment_method, status: 'pending',
          hyperswitch_payment_id: null, x402_receipt_id: null,
          customer_id: null, failure_reason: null, expires_at,
        };
        dbRows.push(row);
        return { rows: [{ id: row.id }], rowCount: 1 };
      }
      if (sql.startsWith('SELECT * FROM checkout_sessions')) {
        const [id] = params as string[];
        const row = dbRows.find((r) => r.id === id);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE checkout_sessions SET hyperswitch_payment_id')) {
        const [paymentId, id] = params as string[];
        const row = dbRows.find((r) => r.id === id);
        if (row) row.hyperswitch_payment_id = paymentId;
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE checkout_sessions SET x402_receipt_id')) {
        const [receiptId, id] = params as string[];
        const row = dbRows.find((r) => r.id === id);
        if (row) row.x402_receipt_id = receiptId;
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('UPDATE checkout_sessions SET')) {
        // markSession's dynamic UPDATE — last param is always the id.
        const id = params[params.length - 1] as string;
        const row = dbRows.find((r) => r.id === id);
        if (row) {
          if (sql.includes('status = $1') || sql.includes('status')) {
            // best-effort: apply whatever fields markSession sent, in order
          }
          Object.assign(row, inferMarkSessionFields(sql, params));
        }
        return { rows: [], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO customers')) {
        return { rows: [{ id: 'cust_test_1' }], rowCount: 1 };
      }
      if (sql.startsWith('INSERT INTO forgepay_events')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`unmocked query: ${sql}`);
    }),
  },
}));

function inferMarkSessionFields(sql: string, params: unknown[]): Record<string, unknown> {
  const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
  const cols = setClause.split(',').map((c) => c.trim().split('=')[0]!.trim()).filter((c) => c !== 'updated_at');
  const out: Record<string, unknown> = {};
  cols.forEach((col, i) => { out[col] = params[i]; });
  return out;
}

import { buildCheckoutRoutes } from '../src/routes/checkout.js';
import * as hyperswitch from '../src/lib/hyperswitch-client.js';
import * as stablecoin from '../src/lib/stablecoin-client.js';
import * as killbill from '../src/lib/killbill-client.js';

let app: FastifyInstance;

beforeEach(async () => {
  dbRows.length = 0;
  vi.clearAllMocks();
  app = Fastify();
  await app.register(buildCheckoutRoutes);
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

describe('POST /v1/checkout/sessions', () => {
  it('rejects an unknown tier before touching any payment provider', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'a@b.com', businessName: 'Acme', tierId: 'gold-plus-ultra' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('UnknownTier');
    expect(hyperswitch.createPaymentIntent).not.toHaveBeenCalled();
  });

  it('rejects standard tier with no payment method', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'a@b.com', businessName: 'Acme', tierId: 'standard' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('ValidationError');
  });

  it('provisions the free tier immediately, no payment provider called', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'free@b.com', businessName: 'Acme', tierId: 'free' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('succeeded');
    expect(body.customerId).toBe('cust_test_1');
    expect(hyperswitch.createPaymentIntent).not.toHaveBeenCalled();
    expect(stablecoin.requestX402Payment).not.toHaveBeenCalled();
  });

  it('standard + card creates a Hyperswitch intent and returns pending_card', async () => {
    vi.mocked(hyperswitch.createPaymentIntent).mockResolvedValue({
      ok: true, paymentId: 'pay_123', clientSecret: 'secret_abc', status: 'requires_payment_method',
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'card@b.com', businessName: 'Acme', tierId: 'standard', paymentMethod: 'card' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe('pending_card');
    expect(body.clientSecret).toBe('secret_abc');
    // 2800 cents = $28.00, from pricing.yaml — never hand-typed here.
    expect(body.amountCents).toBe(2800);
  });

  it('standard + card surfaces a Hyperswitch outage as a visible error, not a hang', async () => {
    vi.mocked(hyperswitch.createPaymentIntent).mockResolvedValue({
      ok: false, reason: 'call_failed', message: 'payment-engine unreachable',
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'card2@b.com', businessName: 'Acme', tierId: 'standard', paymentMethod: 'card' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().status).toBe('error');
  });

  it('standard + usdc opens an x402 intent and returns pending_usdc', async () => {
    vi.mocked(stablecoin.requestX402Payment).mockResolvedValue({
      ok: true, receiptId: 'rcpt_1', depositId: 'dep_1', amountUnits: '28000000', chain: 'base', token: 'USDC', expiresAt: '2026-01-01T00:00:00Z',
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'usdc@b.com', businessName: 'Acme', tierId: 'standard', paymentMethod: 'usdc' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().status).toBe('pending_usdc');
  });
});

describe('POST /v1/checkout/sessions/:id/confirm', () => {
  async function createCardSession() {
    vi.mocked(hyperswitch.createPaymentIntent).mockResolvedValue({
      ok: true, paymentId: 'pay_confirm', clientSecret: 'secret', status: 'requires_payment_method',
    });
    const res = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'confirm@b.com', businessName: 'Acme', tierId: 'standard', paymentMethod: 'card' },
    });
    return res.json().sessionId as string;
  }

  it('a succeeded card payment confirms and provisions', async () => {
    const sessionId = await createCardSession();
    vi.mocked(hyperswitch.getPayment).mockResolvedValue({ ok: true, status: 'succeeded', amountCents: 2800, currency: 'USD' });

    const res = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${sessionId}/confirm` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('succeeded');
    expect(body.customerId).toBe('cust_test_1');
  });

  it('registers the card saved at checkout with Kill Bill, before subscribing, so renewals can be charged', async () => {
    const sessionId = await createCardSession();
    vi.mocked(hyperswitch.getPayment).mockResolvedValue({
      ok: true, status: 'succeeded', amountCents: 2800, currency: 'USD', customerId: 'fp_abc', paymentMethodId: 'pm_saved',
    });

    const res = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${sessionId}/confirm` });
    expect(res.json().status).toBe('succeeded');
    expect(killbill.addHyperswitchPaymentMethod).toHaveBeenCalledWith('kb_acct_test', 'fp_abc', 'pm_saved');
    expect(vi.mocked(killbill.addHyperswitchPaymentMethod).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(killbill.createSubscription).mock.invocationCallOrder[0]!);
    expect(killbill.createSubscription).toHaveBeenCalledWith(expect.objectContaining({ planName: 'payments-standard' }));
  });

  it('still provisions a paid customer when Hyperswitch saved no card, without inventing one', async () => {
    const sessionId = await createCardSession();
    vi.mocked(hyperswitch.getPayment).mockResolvedValue({ ok: true, status: 'succeeded', amountCents: 2800, currency: 'USD' });
    const res = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${sessionId}/confirm` });
    expect(res.json().status).toBe('succeeded');
    expect(killbill.addHyperswitchPaymentMethod).not.toHaveBeenCalled();
  });

  it('a declined card is reported as declined, not hidden or retried silently', async () => {
    const sessionId = await createCardSession();
    vi.mocked(hyperswitch.getPayment).mockResolvedValue({ ok: true, status: 'failed', amountCents: 2800, currency: 'USD' });

    const res = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${sessionId}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('declined');
  });

  it('an unconfirmed x402 payment reports pending, never a false success', async () => {
    vi.mocked(stablecoin.requestX402Payment).mockResolvedValue({
      ok: true, receiptId: 'rcpt_pending', depositId: 'd', amountUnits: '1', chain: 'base', token: 'USDC', expiresAt: '2099-01-01T00:00:00Z',
    });
    const create = await app.inject({
      method: 'POST', url: '/v1/checkout/sessions',
      payload: { email: 'stall@b.com', businessName: 'Acme', tierId: 'standard', paymentMethod: 'usdc' },
    });
    const sessionId = create.json().sessionId as string;

    vi.mocked(stablecoin.verifyX402Payment).mockResolvedValue({ ok: true, valid: false, status: 'pending_confirmation' });
    const res = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${sessionId}/confirm` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('pending_usdc');
  });

  it('a session past its TTL is marked expired on confirm, not left pending forever', async () => {
    const sessionId = await createCardSession();
    const row = dbRows.find((r) => (r as { id: string }).id === sessionId)!;
    (row as { expires_at: string }).expires_at = new Date(Date.now() - 1000).toISOString();

    const res = await app.inject({ method: 'POST', url: `/v1/checkout/sessions/${sessionId}/confirm` });
    expect(res.json().status).toBe('expired');
  });

  it('confirming an unknown session id 404s rather than crashing', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/checkout/sessions/does-not-exist/confirm' });
    expect(res.statusCode).toBe(404);
  });
});

describe('hyperswitchCustomerIdFor', () => {
  it('is stable per email, case-insensitive, and not the email itself', () => {
    const a = hyperswitch.hyperswitchCustomerIdFor('Owner@Example.com');
    expect(a).toBe(hyperswitch.hyperswitchCustomerIdFor(' owner@example.com '));
    expect(a).toMatch(/^fp_[0-9a-f]{32}$/);
    expect(a).not.toContain('example');
  });
});
