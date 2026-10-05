/**
 * Internal settlement routes (wire + stablecoin), called by enterprise-treasury.
 *
 * No payment rail is connected, so a settlement is an instruction for an
 * operator. These used to return `submitted` with a made-up SWIFT UETR or
 * transaction hash; the tests below make sure nothing claims money moved.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { buildInternalRoutes, MemorySettlementStore } from '../routes/internal';

let app: ReturnType<typeof Fastify>;
let store: MemorySettlementStore;

beforeEach(async () => {
  store = new MemorySettlementStore();
  app = Fastify({ logger: false });
  await app.register(buildInternalRoutes, { store });
  await app.ready();
});

afterEach(async () => {
  await app.close();
});

const HEADERS = { 'Content-Type': 'application/json', 'x-source': 'enterprise-treasury' };
const OPS = { 'Content-Type': 'application/json', 'x-source': 'operations-console' };
const wire = { from: 'HQ', to: 'EMEA', amountUsd: 200_000, currency: 'USD', reference: 'NET-HQ-EMEA-2026-05-16', invoiceRefs: ['INV-001'] };

describe('POST /v1/transfers/wire and /stablecoin', () => {
  it('records an instruction awaiting execution, with no invented bank or chain reference', async () => {
    for (const url of ['/v1/transfers/wire', '/v1/transfers/stablecoin']) {
      const resp = await app.inject({ method: 'POST', url, headers: HEADERS, payload: wire });
      expect(resp.statusCode).toBe(202);
      const body = resp.json();
      expect(body.status).toBe('awaiting_execution');
      expect(body.executed).toBe(false);
      expect(body.swiftRef).toBeUndefined();
      expect(body.txHash).toBeUndefined();
      expect(body.note).toMatch(/nothing has been sent/);
    }
    expect(store.records.size).toBe(2);
  });

  it('rejects bad input and unknown callers', async () => {
    expect((await app.inject({ method: 'POST', url: '/v1/transfers/wire', headers: HEADERS, payload: { from: 'HQ' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/v1/transfers/wire', headers: { 'Content-Type': 'application/json' }, payload: wire })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/transfers/wire', headers: { ...HEADERS, 'x-source': 'nobody' }, payload: wire })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/transfers/stablecoin', headers: HEADERS, payload: { ...wire, amountUsd: -5 } })).statusCode).toBe(400);
  });
});

describe('GET /v1/transfers/internal[/:id]', () => {
  it('reads an instruction back and lists recent ones', async () => {
    const created = (await app.inject({ method: 'POST', url: '/v1/transfers/wire', headers: HEADERS, payload: wire })).json();
    const one = await app.inject({ method: 'GET', url: `/v1/transfers/internal/${created.transferId}`, headers: HEADERS });
    expect(one.json().data.status).toBe('awaiting_execution');
    expect(one.json().data.invoiceRefs).toEqual(['INV-001']);
    const list = await app.inject({ method: 'GET', url: '/v1/transfers/internal', headers: HEADERS });
    expect(list.json().total).toBe(1);
    expect((await app.inject({ method: 'GET', url: '/v1/transfers/internal/nope', headers: HEADERS })).statusCode).toBe(404);
  });
});

describe('POST /v1/transfers/internal/:id/executed', () => {
  it('lets only the operations console record the real reference, once', async () => {
    const { transferId } = (await app.inject({ method: 'POST', url: '/v1/transfers/wire', headers: HEADERS, payload: wire })).json();
    const payload = { externalRef: 'UETR-REAL-FROM-BANK', executedBy: 'ops@forge' };

    expect((await app.inject({ method: 'POST', url: `/v1/transfers/internal/${transferId}/executed`, headers: HEADERS, payload })).statusCode).toBe(403);

    const ok = await app.inject({ method: 'POST', url: `/v1/transfers/internal/${transferId}/executed`, headers: OPS, payload });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.status).toBe('executed');
    expect(ok.json().data.externalRef).toBe('UETR-REAL-FROM-BANK');

    const again = await app.inject({ method: 'POST', url: `/v1/transfers/internal/${transferId}/executed`, headers: OPS, payload: { ...payload, externalRef: 'OTHER-REF' } });
    expect(again.statusCode).toBe(409);
  });
});

describe('virtual accounts', () => {
  it('are no longer open to unauthenticated callers', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/transfers/internal/accounts', payload: { id: 'va1', accountName: 'x', accountType: 'y', currency: 'USD' } });
    expect(res.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/transfers/internal/accounts/va1' })).statusCode).toBe(401);
  });
});

describe('GET /v1/transfers/internal/balances', () => {
  it('returns one merchant\'s stored balances to an internal caller', async () => {
    const local = Fastify({ logger: false });
    const seen: string[] = [];
    await local.register(buildInternalRoutes, {
      store: new MemorySettlementStore(),
      balances: async (m: string) => { seen.push(m); return [{ id: 'a1', bankName: 'Bank', accountName: 'Ops', accountType: 'checking', currency: 'ZAR', balanceAvailable: 10, balanceCurrent: 12, lastRefreshed: '2026-10-05T00:00:00.000Z' }]; },
    });
    await local.ready();
    const res = await local.inject({ method: 'GET', url: '/v1/transfers/internal/balances?merchantId=m1', headers: HEADERS });
    expect(res.json().data[0].balanceCurrent).toBe(12);
    expect(seen).toEqual(['m1']);
    expect((await local.inject({ method: 'GET', url: '/v1/transfers/internal/balances', headers: HEADERS })).statusCode).toBe(400);
    expect((await local.inject({ method: 'GET', url: '/v1/transfers/internal/balances?merchantId=m1' })).statusCode).toBe(401);
    await local.close();
  });
});
