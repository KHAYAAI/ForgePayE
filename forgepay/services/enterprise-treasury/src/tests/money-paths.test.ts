/**
 * Treasury must not lose obligations, move money nobody configured, or show
 * balances it never read.
 *
 * Regressions guarded:
 *   - /v1/netting/settle cleared the netting queue on a dry run and after
 *     failed dispatches, so intercompany obligations were simply lost;
 *   - default rules swept everything above $2M into Aave without anyone
 *     asking, through yield-engine routes that never existed;
 *   - balances came from a bank-connectivity route that never existed, the
 *     failure was swallowed, and treasury showed no accounts.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { buildApp } from '../index';
import { addFlow, listFlows, clearSettledFlows } from '../netting';
import { refreshAccountBalances, getLastRefreshError } from '../consolidator';

const KEY = 'a-test-api-key-long-enough-to-pass-strength-checks';
const ORIGINAL_ENV = { ...process.env };
const H = { 'x-api-key': KEY };

beforeAll(() => {
  process.env['VALID_API_KEYS'] = KEY;
  process.env['CORS_ORIGIN'] = 'https://treasury.forgepay.test';
});

afterAll(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearSettledFlows();
});

function seedFlows() {
  addFlow({ fromSubsidiary: 'HQ', toSubsidiary: 'EMEA', amount: 500_000, currency: 'USD', invoiceRef: 'INV-1', dueDate: '2026-10-31' });
  addFlow({ fromSubsidiary: 'EMEA', toSubsidiary: 'HQ', amount: 200_000, currency: 'USD', invoiceRef: 'INV-2', dueDate: '2026-10-31' });
}

describe('POST /v1/netting/settle', () => {
  it('a dry run leaves the netting queue alone', async () => {
    seedFlows();
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/netting/settle', headers: H });
    expect(res.statusCode).toBe(200);
    expect(listFlows()).toHaveLength(2);
    await app.close();
  });

  it('keeps the queue when bank-connectivity fails, and says so', async () => {
    seedFlows();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })));
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/netting/settle?execute=true', headers: H });
    expect(res.statusCode).toBe(502);
    expect(res.json().failed).toBeGreaterThan(0);
    expect(listFlows()).toHaveLength(2);
    await app.close();
  });

  it('clears the queue only when every instruction was recorded, and reports them as awaiting execution', async () => {
    seedFlows();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ transferId: 't1', status: 'awaiting_execution' }), { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    process.env['INTERNAL_SECRET'] = 'shared-secret';
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/v1/netting/settle?execute=true', headers: H });
    expect(res.statusCode).toBe(200);
    expect(res.json().awaitingExecution).toBeGreaterThan(0);
    expect(listFlows()).toHaveLength(0);
    const sent = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((sent.headers as Record<string, string>)['x-internal-secret']).toBe('shared-secret');
    delete process.env['INTERNAL_SECRET'];
    await app.close();
  });
});

describe('treasury rules', () => {
  it('start empty: no rule moves money unless someone configures it', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/v1/rules', headers: H });
    expect(res.json().data.filter((r: { id: string }) => r.id.startsWith('default_'))).toEqual([]);
    await app.close();
  });

  it('refuse sweeping into or out of yield', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/rules', headers: H,
      payload: {
        id: 'r_sweep', name: 'sweep', condition: { type: 'balance_above', threshold: 1 },
        action: { type: 'sweep_to_yield', targetVault: 'aave' },
      },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });
});

describe('refreshAccountBalances', () => {
  it('fails loudly without a merchant to load', async () => {
    delete process.env['TREASURY_MERCHANT_ID'];
    await expect(refreshAccountBalances('http://bank')).rejects.toThrow(/TREASURY_MERCHANT_ID/);
    expect(getLastRefreshError()).toMatch(/TREASURY_MERCHANT_ID/);
  });

  it('reads the merchant\'s stored balances, with when the bank was last read', async () => {
    process.env['TREASURY_MERCHANT_ID'] = 'm1';
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [
      { id: 'a1', bankName: 'FNB', accountName: 'Ops', accountType: 'checking', currency: 'USD', balanceAvailable: 90, balanceCurrent: 100, lastRefreshed: '2026-10-04T12:00:00.000Z' },
    ] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const accounts = await refreshAccountBalances('http://bank');
    expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe('http://bank/v1/transfers/internal/balances?merchantId=m1');
    expect(accounts[0]!.balanceNative).toBe(100);
    expect(accounts[0]!.lastUpdated).toBe('2026-10-04T12:00:00.000Z');
    delete process.env['TREASURY_MERCHANT_ID'];
  });
});
