/**
 * Billing — the revenue path.
 *
 * Before this module, INQUIRY_FEE_USD was computed and displayed everywhere
 * (report responses, /v1/grade-scale, bureauStats().inquiryRevenueUsd) but
 * nothing ever charged it. These tests guard the two things that matter for a
 * real ledger:
 *
 *  - money actually moves: an unfunded pull is refused, a funded one debits
 *    exactly the fee, and revenue reported by the bureau is the real sum of
 *    what was charged, not an estimate;
 *  - a declined charge behaves like declined consent already did — no trace
 *    on the file, and (the regression this suite exists to catch) the
 *    agent's one-time consent token survives to be retried once funded,
 *    rather than being silently burned by a pull that never happened.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { buildApp } from './index';
import {
  getAccountSummary, creditAccount, debitAccount, chargeInquiryFee,
  billingHistory, requestTopUp, confirmTopUp, usdToCents, centsToUsd,
} from './billing';
import { getProfile, bureauStats } from './store';
import { INQUIRY_FEE_USD } from './grade';

const ADMIN = 'dev-bureau-admin-key';
const AGENT = 'agent_prime_001'; // seeded, unfrozen

const bearer = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });

function mockFetch(body: unknown, ok = true, status = ok ? 200 : 500) {
  const fn = vi.fn(async (_url: string, _opts?: RequestInit) => ({
    ok, status, json: async () => body, text: async () => JSON.stringify(body),
  }));
  vi.stubGlobal('fetch', fn);
  return fn;
}

// ── Pure ledger math ─────────────────────────────────────────────────────────

describe('billing.ts — ledger', () => {
  it('starts a new requestor at a zero balance', () => {
    const id = `req_${randomUUID()}`;
    const account = getAccountSummary(id);
    expect(account.balanceUsdCents).toBe(0);
  });

  it('credits and debits in exact integer cents, no float drift', () => {
    const id = `req_${randomUUID()}`;
    creditAccount(id, 10.1, 'test credit');
    creditAccount(id, 0.2, 'test credit');
    const after = getAccountSummary(id);
    // 10.10 + 0.20 in naive floating point is 10.299999999999999.
    expect(after.balanceUsdCents).toBe(1030);
    expect(centsToUsd(after.balanceUsdCents)).toBe(10.3);
  });

  it('refuses to credit a non-positive amount', () => {
    const id = `req_${randomUUID()}`;
    expect(() => creditAccount(id, 0, 'x')).toThrow();
    expect(() => creditAccount(id, -5, 'x')).toThrow();
  });

  it('debits successfully when funded, and records the transaction', () => {
    const id = `req_${randomUUID()}`;
    creditAccount(id, 5, 'fund');
    const result = debitAccount(id, 2.8, 'inquiry_fee:test');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.account.balanceUsdCents).toBe(220); // 500 - 280
    expect(result.transaction.type).toBe('debit');
    expect(result.transaction.balanceAfterUsdCents).toBe(220);

    // Sorted most-recent-first by ISO timestamp, which only has millisecond
    // resolution — a credit and debit issued in the same synchronous call can
    // tie, so this checks the entries rather than assuming strict ordering.
    const history = billingHistory(id);
    expect(history).toHaveLength(2);
    expect(history.map(t => t.type).sort()).toEqual(['credit', 'debit']);
    expect(history.find(t => t.type === 'debit')).toMatchObject({ amountUsdCents: 280, balanceAfterUsdCents: 220 });
  });

  it('refuses a debit that would overdraw the account, leaving the balance untouched', () => {
    const id = `req_${randomUUID()}`;
    creditAccount(id, 1, 'fund');
    const result = debitAccount(id, 2.8, 'inquiry_fee:test');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('insufficient_funds');
    expect(result.balanceUsdCents).toBe(100);
    expect(result.requiredUsdCents).toBe(280);
    expect(getAccountSummary(id).balanceUsdCents).toBe(100); // unchanged
    expect(billingHistory(id)).toHaveLength(1); // only the original credit
  });

  it('chargeInquiryFee debits exactly INQUIRY_FEE_USD', () => {
    const id = `req_${randomUUID()}`;
    creditAccount(id, 100, 'fund');
    const result = chargeInquiryFee(id, 'inquiry_fee:agent_x:credit_application');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.transaction.amountUsdCents).toBe(usdToCents(INQUIRY_FEE_USD));
  });
});

// ── x402 top-up client ───────────────────────────────────────────────────────

describe('billing.ts — x402 top-up', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.unstubAllGlobals();
    delete process.env['STABLECOIN_GATEWAY_URL'];
  });
  afterAll(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
  });

  it('refuses to open a top-up when STABLECOIN_GATEWAY_URL is unset', async () => {
    const fetchFn = mockFetch({});
    const out = await requestTopUp('req_x', 10);
    expect(out).toMatchObject({ ok: false, reason: 'not_configured' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects a non-positive top-up amount without calling the gateway', async () => {
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://stablecoin-gateway:8020';
    const fetchFn = mockFetch({});
    const out = await requestTopUp('req_x', 0);
    expect(out).toMatchObject({ ok: false, reason: 'amount_invalid' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs /x402/pay with the bureau as merchant and tracks the receipt locally', async () => {
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://stablecoin-gateway:8020';
    const fetchFn = mockFetch({
      receipt_id: 'rcpt_1', deposit_id: 'dep_1', amount_usdc: 10, amount_units: '10000000',
      chain: 'base', token: 'USDC', expires_at: '2099-01-01T00:00:00.000Z', status: 'pending',
    });

    const out = await requestTopUp('req_topup_1', 10);
    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.receipt.receiptId).toBe('rcpt_1');
    expect(out.receipt.status).toBe('pending');
    expect(out.gateway.depositId).toBe('dep_1');

    const [url, opts] = fetchFn.mock.calls[0]!;
    expect(url).toBe('http://stablecoin-gateway:8020/x402/pay');
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body).toMatchObject({ amount_usdc: 10, merchant_id: 'forgepay-credit-bureau', agent_id: 'req_topup_1' });
  });

  it('treats a non-2xx /x402/pay response as call_failed', async () => {
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://stablecoin-gateway:8020';
    mockFetch({ error: 'boom' }, false, 500);
    const out = await requestTopUp('req_x', 10);
    expect(out).toMatchObject({ ok: false, reason: 'call_failed' });
  });

  it('confirmTopUp reports not_found for an unknown receipt', async () => {
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://stablecoin-gateway:8020';
    const out = await confirmTopUp('rcpt_never_existed', 'req_x');
    expect(out).toMatchObject({ ok: false, reason: 'not_found' });
  });

  it('confirmTopUp credits the ledger exactly once, and is idempotent on retry', async () => {
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://stablecoin-gateway:8020';
    mockFetch({
      receipt_id: 'rcpt_2', deposit_id: 'dep_2', amount_usdc: 25, amount_units: '25000000',
      chain: 'base', token: 'USDC', expires_at: '2099-01-01T00:00:00.000Z', status: 'pending',
    });
    const requestorId = `req_${randomUUID()}`;
    const opened = await requestTopUp(requestorId, 25);
    if (!opened.ok) throw new Error('unreachable');

    // Not yet paid on-chain.
    mockFetch({ status: 'pending', valid: false });
    const notYet = await confirmTopUp(opened.receipt.receiptId, requestorId);
    expect(notYet).toMatchObject({ ok: false, reason: 'not_yet_paid' });
    expect(getAccountSummary(requestorId).balanceUsdCents).toBe(0);

    // Now confirmed on-chain.
    mockFetch({ status: 'confirmed', valid: true });
    const confirmed = await confirmTopUp(opened.receipt.receiptId, requestorId);
    expect(confirmed).toMatchObject({ ok: true, alreadyConfirmed: false });
    expect(getAccountSummary(requestorId).balanceUsdCents).toBe(2500);

    // A second confirm call (retry, double-click) must not double-credit.
    const fetchFn = mockFetch({ status: 'confirmed', valid: true });
    const again = await confirmTopUp(opened.receipt.receiptId, requestorId);
    expect(again).toMatchObject({ ok: true, alreadyConfirmed: true });
    expect(getAccountSummary(requestorId).balanceUsdCents).toBe(2500); // unchanged
    expect(fetchFn).not.toHaveBeenCalled(); // short-circuits before calling the gateway again
  });

  it('refuses to confirm a top-up for a different requestor', async () => {
    process.env['STABLECOIN_GATEWAY_URL'] = 'http://stablecoin-gateway:8020';
    mockFetch({
      receipt_id: 'rcpt_3', deposit_id: 'dep_3', amount_usdc: 5, amount_units: '5000000',
      chain: 'base', token: 'USDC', expires_at: '2099-01-01T00:00:00.000Z', status: 'pending',
    });
    const opened = await requestTopUp('req_owner', 5);
    if (!opened.ok) throw new Error('unreachable');

    const out = await confirmTopUp(opened.receipt.receiptId, 'req_attacker');
    expect(out).toMatchObject({ ok: false, reason: 'requestor_mismatch' });
  });
});

// ── HTTP — the actual revenue path end to end ────────────────────────────────

describe('billing HTTP routes and the pull-side charge', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });
  afterAll(async () => { await app.close(); });

  async function issueConsent(requestorId: string, agentId = AGENT): Promise<string> {
    const res = await app.inject({
      method: 'POST', url: '/v1/consent', headers: bearer(ADMIN),
      payload: { agentId, requestorId, purpose: 'credit_application' },
    });
    return res.json().data.consentToken;
  }

  async function pullReport(requestorId: string, consentToken: string) {
    return app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(ADMIN),
      payload: {
        agentId: AGENT, requestorId, requestorName: 'Test Lender',
        purpose: 'credit_application', consentToken,
      },
    });
  }

  it('GET account auto-creates at zero and requires auth', async () => {
    const id = `req_${randomUUID()}`;
    const unauth = await app.inject({ method: 'GET', url: `/v1/billing/${id}/account` });
    expect(unauth.statusCode).toBe(401);

    const res = await app.inject({ method: 'GET', url: `/v1/billing/${id}/account`, headers: bearer(ADMIN) });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toMatchObject({ requestorId: id, balanceUsd: 0, inquiryFeeUsd: INQUIRY_FEE_USD, pullsRemaining: 0 });
  });

  it('admin credit funds an account and shows up in the transaction history', async () => {
    const id = `req_${randomUUID()}`;
    const res = await app.inject({
      method: 'POST', url: `/v1/billing/${id}/credit`, headers: bearer(ADMIN),
      payload: { amountUsd: 50, reason: 'invoice #123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.balanceUsd).toBe(50);

    const history = await app.inject({ method: 'GET', url: `/v1/billing/${id}/transactions`, headers: bearer(ADMIN) });
    expect(history.json().data[0]).toMatchObject({ type: 'credit', amountUsd: 50, reason: 'manual:invoice #123' });
  });

  it('is admin-only — a non-admin cannot credit an account', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN),
      payload: { name: 'Billing Test Furnisher', type: 'saas_platform', permissions: ['pull_scores'] },
    });
    const { id: furnisherId, apiKey } = reg.json().data;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${furnisherId}/status`, headers: bearer(ADMIN), payload: { status: 'active', reason: 'test' } });

    const res = await app.inject({
      method: 'POST', url: `/v1/billing/${furnisherId}/credit`, headers: bearer(apiKey),
      payload: { amountUsd: 1000, reason: 'self-serve free money' },
    });
    expect(res.statusCode).toBe(403);
  });

  it("refuses a furnisher reading a competitor's billing account", async () => {
    const victim = `req_${randomUUID()}`;
    await app.inject({ method: 'POST', url: `/v1/billing/${victim}/credit`, headers: bearer(ADMIN), payload: { amountUsd: 10, reason: 'seed' } });

    const reg = await app.inject({
      method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN),
      payload: { name: `Attacker ${randomUUID()}`, type: 'saas_platform', permissions: ['pull_scores'] },
    });
    const { id: attackerId, apiKey } = reg.json().data;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${attackerId}/status`, headers: bearer(ADMIN), payload: { status: 'active', reason: 'test' } });

    const res = await app.inject({ method: 'GET', url: `/v1/billing/${victim}/account`, headers: bearer(apiKey) });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a pull attributed to a requestorId the caller does not own', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/v1/contributors', headers: bearer(ADMIN),
      payload: { name: `Impersonator ${randomUUID()}`, type: 'saas_platform', permissions: ['pull_scores'] },
    });
    const { id: callerId, apiKey } = reg.json().data;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${callerId}/status`, headers: bearer(ADMIN), payload: { status: 'active', reason: 'test' } });

    const victimRequestorId = `req_${randomUUID()}`;
    await app.inject({ method: 'POST', url: `/v1/billing/${victimRequestorId}/credit`, headers: bearer(ADMIN), payload: { amountUsd: 100, reason: 'seed' } });
    const consentToken = await issueConsent(victimRequestorId);

    const res = await app.inject({
      method: 'POST', url: '/v1/reports', headers: bearer(apiKey),
      payload: { agentId: AGENT, requestorId: victimRequestorId, requestorName: 'x', purpose: 'credit_application', consentToken },
    });
    expect(res.statusCode).toBe(403);
    // The victim's balance must be untouched — the whole point of the check.
    expect(getAccountSummary(victimRequestorId).balanceUsdCents).toBe(10_000);
  });

  it(
    'refuses an unfunded pull with 402, records no inquiry, and — the regression this guards — ' +
    'does not burn the consent token, so the same token succeeds once funded',
    async () => {
      const requestorId = `req_${randomUUID()}`;
      const consentToken = await issueConsent(requestorId);

      const before = getProfile(AGENT)!.hardInquiries.length;

      const denied = await pullReport(requestorId, consentToken);
      expect(denied.statusCode).toBe(402);
      expect(denied.json().error).toBe('PaymentRequired');
      expect(denied.json().balanceUsd).toBe(0);
      expect(denied.json().requiredUsd).toBe(INQUIRY_FEE_USD);
      expect(getProfile(AGENT)!.hardInquiries.length).toBe(before); // no trace

      // Fund the account, then retry with the exact same (still-valid) token.
      await app.inject({
        method: 'POST', url: `/v1/billing/${requestorId}/credit`, headers: bearer(ADMIN),
        payload: { amountUsd: 10, reason: 'top up after decline' },
      });

      const retried = await pullReport(requestorId, consentToken);
      expect(retried.statusCode).toBe(201);
      expect(getProfile(AGENT)!.hardInquiries.length).toBe(before + 1);

      // And now the token really is spent — a third attempt fails on consent,
      // not billing, even though the account still has funds.
      const thirdTry = await pullReport(requestorId, consentToken);
      expect(thirdTry.statusCode).toBe(403);
      expect(thirdTry.json().error).toBe('ConsentInvalid');
    },
  );

  it('debits exactly INQUIRY_FEE_USD per pull and ties the inquiry to the ledger entry', async () => {
    const requestorId = `req_${randomUUID()}`;
    await app.inject({ method: 'POST', url: `/v1/billing/${requestorId}/credit`, headers: bearer(ADMIN), payload: { amountUsd: 10, reason: 'seed' } });

    const consentToken = await issueConsent(requestorId);
    const res = await pullReport(requestorId, consentToken);
    expect(res.statusCode).toBe(201);

    const account = await app.inject({ method: 'GET', url: `/v1/billing/${requestorId}/account`, headers: bearer(ADMIN) });
    expect(account.json().data.balanceUsd).toBe(+(10 - INQUIRY_FEE_USD).toFixed(2));

    const profile = getProfile(AGENT)!;
    const inquiry = profile.hardInquiries[profile.hardInquiries.length - 1]!;
    expect(inquiry.requestorId).toBe(requestorId);
    expect(inquiry.billingTransactionId).toBeTruthy();

    const history = await app.inject({ method: 'GET', url: `/v1/billing/${requestorId}/transactions`, headers: bearer(ADMIN) });
    const debit = history.json().data.find((t: { id: string }) => t.id === inquiry.billingTransactionId);
    expect(debit).toMatchObject({ type: 'debit', amountUsd: INQUIRY_FEE_USD, reason: `inquiry_fee:${AGENT}:credit_application` });
  });

  it('bureauStats reports real charged revenue, not an estimate over uncharged demo data', async () => {
    const before = bureauStats().inquiryRevenueUsd;

    const requestorId = `req_${randomUUID()}`;
    await app.inject({ method: 'POST', url: `/v1/billing/${requestorId}/credit`, headers: bearer(ADMIN), payload: { amountUsd: 10, reason: 'seed' } });
    const consentToken = await issueConsent(requestorId);
    const res = await pullReport(requestorId, consentToken);
    expect(res.statusCode).toBe(201);

    const after = bureauStats().inquiryRevenueUsd;
    expect(+(after - before).toFixed(2)).toBe(INQUIRY_FEE_USD);
  });
});
