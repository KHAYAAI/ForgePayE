import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const store = new Map<string, any>();
vi.mock('../src/lib/payouts.js', async (orig) => {
  const real = await orig<typeof import('../src/lib/payouts.js')>();
  return {
    ...real,
    findPayoutByExternalId: async (by: string, ext: string) => [...store.values()].find((p) => p.requestedBy === by && p.externalId === ext) ?? null,
    createPayout: async (i: any) => { const { asset, ...rest } = i; const p = { id: `p${store.size + 1}`, ...rest, status: 'pending_approval' }; store.set(p.id, p); return { payout: p, deduplicated: false }; },
    getPayout: async (id: string) => store.get(id) ?? null,
    approvePayout: async (id: string, by: string) => { const p = store.get(id); if (!p) return { ok: false, reason: 'not_found', status: null }; p.status = 'approved'; p.approvedBy = by; return { ok: true, payout: p }; },
    rejectPayout: async () => ({ ok: false, reason: 'not_found', status: null }),
    submitPayout: vi.fn(async () => ({ ok: false, reason: 'not_found' })),
    listPayouts: async () => [...store.values()],
  };
});
vi.mock('../src/lib/context.js', () => ({ gatewayContext: async () => ({ registry: {}, rates: {} }) }));
vi.mock('../src/lib/deposit-open.js', async (orig) => ({
  ...(await orig<typeof import('../src/lib/deposit-open.js')>()),
  quoteAmount: async () => ({ units: 1_000_000n, asset: { decimals: 6, unit: 'USD' }, quote: {} }),
}));

async function app() {
  process.env['NODE_ENV'] = 'test';
  process.env['VALID_API_KEYS'] = 'admin-key-' + 'a'.repeat(40);
  process.env['MERCHANT_API_KEYS'] = 'shop1:merchant-key-' + 'b'.repeat(40);
  const { default: auth } = await import('../src/plugins/api-key-auth.js');
  const { buildPayoutRoutes } = await import('../src/routes/payouts.js');
  const a = Fastify();
  await a.register(auth);
  await a.register(buildPayoutRoutes, { prefix: '/payouts' });
  return a;
}
const ADMIN = { 'x-api-key': 'admin-key-' + 'a'.repeat(40), 'x-forge-service': 'agent-credit-bureau' };
const MERCHANT = { 'x-api-key': 'merchant-key-' + 'b'.repeat(40), 'x-forge-service': 'agent-credit-bureau' };
const payout = { external_id: 'furnisher_f1_2026-09', payee_id: 'f1', payee_address: '0x' + '11'.repeat(20), amount_usd: 50, reason: 'rev share' };

describe('payout routes are operator-only', () => {
  beforeEach(() => store.clear());

  it('a merchant key cannot create, read, approve, reject or submit payouts (was: any key could)', async () => {
    const a = await app();
    const calls: Array<[string, string, any?]> = [
      ['POST', '/payouts', payout], ['GET', '/payouts'], ['GET', '/payouts/p1'], ['GET', '/payouts/config'],
      ['POST', '/payouts/p1/approve', { approved_by: 'x' }], ['POST', '/payouts/p1/reject', { rejected_by: 'x' }], ['POST', '/payouts/p1/submit', {}],
    ];
    for (const [method, url, body] of calls) {
      const r = await a.inject({ method: method as any, url, headers: MERCHANT, ...(body ? { payload: body } : {}) });
      expect(r.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(store.size).toBe(0);
  });

  it('no key at all is refused', async () => {
    const a = await app();
    expect((await a.inject({ method: 'POST', url: '/payouts', payload: payout })).statusCode).toBe(401);
  });

  it('an admin credential still works', async () => {
    const a = await app();
    const r = await a.inject({ method: 'POST', url: '/payouts', headers: ADMIN, payload: payout });
    expect(r.statusCode, r.body).toBe(201);
  });

  it('re-using an external id for a different address or amount is a conflict, not "already done"', async () => {
    const a = await app();
    await a.inject({ method: 'POST', url: '/payouts', headers: ADMIN, payload: payout });
    const same = await a.inject({ method: 'POST', url: '/payouts', headers: ADMIN, payload: payout });
    expect(same.statusCode).toBe(200);
    const otherAddr = await a.inject({ method: 'POST', url: '/payouts', headers: ADMIN, payload: { ...payout, payee_address: '0x' + '22'.repeat(20) } });
    expect(otherAddr.statusCode).toBe(409);
    const otherAmt = await a.inject({ method: 'POST', url: '/payouts', headers: ADMIN, payload: { ...payout, amount_usd: 5000 } });
    expect(otherAmt.statusCode).toBe(409);
  });

  it('the requester cannot approve their own payout', async () => {
    const a = await app();
    await a.inject({ method: 'POST', url: '/payouts', headers: ADMIN, payload: payout });
    const self = await a.inject({ method: 'POST', url: '/payouts/p1/approve', headers: ADMIN, payload: { approved_by: 'agent-credit-bureau' } });
    expect(self.statusCode).toBe(403);
    const other = await a.inject({ method: 'POST', url: '/payouts/p1/approve', headers: ADMIN, payload: { approved_by: 'ops.khaya@example.com' } });
    expect(other.statusCode).toBe(200);
  });
});
