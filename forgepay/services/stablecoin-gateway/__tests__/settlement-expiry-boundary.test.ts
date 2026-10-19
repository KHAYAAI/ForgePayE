/**
 * Where "on time" ends. A transfer's block timestamp is a whole number of seconds, and the deposit's expiry is compared as a whole second too
 * (settlement.ts: `blockTime <= floor(expiresAt)`). So a payment mined in the SAME second as the expiry counts as on time, even if it is
 * up to a second after the exact instant; only a payment in a LATER second is late. This is a sensible rule, but nothing said so, and the
 * nightly end-to-end test tripped over it: it expired a deposit 0.3 s in the past and paid 0.4 s later, which crosses a second boundary only
 * some of the time, so it failed about one night in four. These tests state the rule against the real settlement code.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/events.js', () => ({ forwardToUnifiedRouter: async () => undefined }));
import { settleChainOnce, type SettlementChain } from '../src/lib/settlement.js';

const TOKEN = '0x' + '11'.repeat(20);
const EXPIRES_MS = Date.parse('2026-10-19T12:00:00.200Z');          // 0.2 s into a second
const EXPIRES_SEC = Math.floor(EXPIRES_MS / 1000);
const asset = { symbol: 'USDC', name: 'USD Coin', chain: 'base', address: TOKEN, unit: 'USD', decimals: 6, verified: true } as any;

async function pay(blockTime: number) {
  const dep = {
    id: 'd1', address: '0x' + 'aa'.repeat(20), amount_units: '1000000', token: 'USDC', decimals: 6, chain: 'base', status: 'pending',
    expires_at: new Date(EXPIRES_MS).toISOString(), scan_cursor: null, scan_units: '0', late_units: '0', from_block: '100', tx_hash: null,
    received_amount_units: null, merchant_id: 'm', network: 'base',
  } as any;
  const writes: Array<{ sql: string; params: unknown[] }> = [];
  const db: any = {
    async query(sql: string, params: unknown[] = []) {
      if (/FROM stablecoin_deposits/.test(sql) && /SELECT/.test(sql) && !/UPDATE/.test(sql)) return { rows: [dep] };
      if (/UPDATE/.test(sql)) { writes.push({ sql, params }); return { rows: [{ id: 'd1' }] }; }
      return { rows: [] };
    },
  };
  const chain: SettlementChain = {
    blockNumber: async () => 200,
    transfersTo: async () => [{ txHash: '0xabc', blockNumber: 150, value: 1_000_000n }],
    blockTime: async () => blockTime,
    balanceOf: async () => 1_000_000n,
  };
  const registry: any = { get: () => asset };
  // "now" is just after the expiry, inside the grace period.
  await settleChainOnce('base', chain, db, registry, { confirmations: () => 12, now: () => new Date(EXPIRES_MS + 1000) });
  const credited = writes.some((w) => w.sql.includes("status = 'confirmed'") && w.sql.includes('stablecoin_deposits'));
  const progress = writes.find((w) => w.sql.includes('late_units = $4'));
  return { credited, scanUnits: progress?.params[2], lateUnits: progress?.params[3] };
}

describe('a payment is on time if it is mined in the expiry second or earlier', () => {
  it('mined before the expiry second: credited, nothing late', async () => {
    expect(await pay(EXPIRES_SEC - 1)).toMatchObject({ credited: true, scanUnits: '1000000', lateUnits: null });
  });

  it('mined in the SAME second as the expiry (up to a second after the exact instant): still on time, credited', async () => {
    expect(await pay(EXPIRES_SEC)).toMatchObject({ credited: true, scanUnits: '1000000', lateUnits: null });
  });

  it('mined in the NEXT second: late. Never credited; recorded as late for reconciliation', async () => {
    expect(await pay(EXPIRES_SEC + 1)).toMatchObject({ credited: false, scanUnits: '0', lateUnits: '1000000' });
  });
});
