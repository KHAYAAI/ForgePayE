import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const queries: Array<{ sql: string; params?: unknown[] }> = [];
let payoutRow: any = null;
vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (/SET status = 'submitted'/.test(sql)) return { rows: payoutRow ? [{ ...payoutRow, status: 'submitted' }] : [] };
      if (/SELECT \* FROM payouts WHERE id/.test(sql)) return { rows: payoutRow ? [{ ...payoutRow, status: 'submitted' }] : [] };
      return { rows: [] };
    }),
  }),
}));

const ENV = { ...process.env };
beforeAll(() => {
  process.env['POSTGRES_PASSWORD'] = 't'; process.env['INTERNAL_WEBHOOK_SECRET'] = 't';
  process.env['CORS_ALLOWED_ORIGINS'] = 'https://app.forgepay.test';
  process.env['VALID_API_KEYS'] = 'test-key-that-is-long-enough-to-pass-strength-checks';
  process.env['NODE_ENV'] = 'test';
});
afterAll(() => { process.env = { ...ENV }; });

describe('rate limit cannot be dodged with a forged X-Forwarded-For (was: keyed on the raw header)', () => {
  it('one client sending a different header each time still hits the limit', async () => {
    const { buildApp } = await import('../src/index.js');
    const app = await buildApp();
    await app.ready();
    let limited = 0;
    for (let i = 0; i < 320; i++) {
      const r = await app.inject({ method: 'GET', url: '/healthz', headers: { 'x-forwarded-for': `10.0.${i >> 8}.${i & 255}` } });
      if (r.statusCode === 429) limited++;
    }
    await app.close();
    expect(limited).toBeGreaterThan(0);
  });

  it('only the configured number of proxy hops is trusted', async () => {
    const { trustedProxyHops } = await import('../src/index.js');
    expect(trustedProxyHops({})).toBe(false);
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: '1' })).toBe(1);
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: 'yes' })).toBe(false);
  });
});

describe('a sent payout whose confirmation times out is not marked failed', () => {
  it('stays submitted with its hash so the worker can settle it from the chain', async () => {
    const { setPayoutBroadcaster, submitPayout, PayoutPendingError } = await import('../src/lib/payouts.js');
    payoutRow = {
      id: 'p1', external_id: 'e', payee_id: 'f', payee_address: '0x' + '11'.repeat(20), chain: 'base', amount_usdc: '5',
      asset: 'USDC', amount_units: '5000000', decimals: 6, status: 'submitted', reason: 'r', requested_by: 'bureau',
      created_at: new Date(), updated_at: new Date(),
    };
    setPayoutBroadcaster({
      name: 'test',
      async broadcast() { throw new PayoutPendingError('0xabc', 'sent but not confirmed in time'); },
    } as any);
    const r = await submitPayout('p1');
    expect(r.ok).toBe(true);
    expect(queries.some((q) => /status = 'failed'/.test(q.sql))).toBe(false);
  });
});
