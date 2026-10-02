import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import { reconcile, transferred, type ReconChain } from '../src/lib/reconcile.js';

const TOKEN = '0x' + '11'.repeat(20);
const TREASURY = '0x' + '22'.repeat(20);
const PAYEE = '0x' + '33'.repeat(20);
const T = ethers.id('Transfer(address,address,uint256)');
const topicOf = (a: string) => '0x' + '00'.repeat(12) + a.slice(2);
const logTo = (to: string, units: bigint, token = TOKEN) => ({ address: token, topics: [T, topicOf('0x' + '99'.repeat(20)), topicOf(to)], data: ethers.toBeHex(units, 32) });

function world(o: { deposits?: any[]; sweeps?: any[]; payouts?: any[]; stuck?: Record<string, any[]>; held?: bigint; receipts?: Record<string, any> }) {
  const db: any = { async query(sql: string) {
    if (/FROM stablecoin_deposits\s+WHERE status = 'confirmed'/.test(sql)) return { rows: o.deposits ?? [] };
    if (/FROM deposit_sweeps WHERE status = 'swept'/.test(sql)) return { rows: o.sweeps ?? [] };
    if (/FROM payouts WHERE status = 'confirmed'/.test(sql)) return { rows: o.payouts ?? [] };
    if (/FROM payouts WHERE status IN/.test(sql)) return { rows: o.stuck?.payout ?? [] };
    if (/FROM deposit_sweeps WHERE status IN/.test(sql)) return { rows: o.stuck?.sweep ?? [] };
    if (/status = 'confirming'/.test(sql)) return { rows: o.stuck?.deposit ?? [] };
    return { rows: [] };
  } };
  const chain: ReconChain = { receipt: async (h) => o.receipts?.[h] ?? null, balanceOf: async () => o.held ?? 0n };
  return { db, chain: () => chain, tokenAddress: () => TOKEN };
}

describe('reconciliation', () => {
  it('is clean when records and chain agree', async () => {
    const r = await reconcile(world({
      deposits: [{ id: 'd1', chain: 'base', token: 'USDC', address: '0xaa', received_amount_units: '1000' }], held: 1000n,
      sweeps: [{ id: 's1', chain: 'base', asset: 'USDC', units: '500', sweep_tx: '0xs', treasury_address: TREASURY }],
      payouts: [{ id: 'p1', chain: 'base', asset: 'USDC', amount_units: '700', tx_hash: '0xp', payee_address: PAYEE }],
      receipts: { '0xs': { status: 1, logs: [logTo(TREASURY, 500n)] }, '0xp': { status: 1, logs: [logTo(PAYEE, 700n)] } },
    }));
    expect(r.clean).toBe(true);
    expect(r.examined).toEqual({ deposits: 1, sweeps: 1, payouts: 1 });
  });

  it('reports a credited deposit whose address holds less', async () => {
    const r = await reconcile(world({ deposits: [{ id: 'd1', chain: 'base', token: 'USDC', address: '0xaa', received_amount_units: '1000' }], held: 990n }));
    expect(r.findings).toMatchObject([{ code: 'deposit_short', severity: 'critical', ref: 'd1' }]);
  });

  it('reports a sweep or payout marked done that the chain does not show (missing, reverted, wrong amount or recipient)', async () => {
    const r = await reconcile(world({
      sweeps: [
        { id: 's-missing', chain: 'base', asset: 'USDC', units: '500', sweep_tx: '0xnone', treasury_address: TREASURY },
        { id: 's-reverted', chain: 'base', asset: 'USDC', units: '500', sweep_tx: '0xrev', treasury_address: TREASURY },
        { id: 's-nohash', chain: 'base', asset: 'USDC', units: '500', sweep_tx: null, treasury_address: TREASURY },
      ],
      payouts: [
        { id: 'p-short', chain: 'base', asset: 'USDC', amount_units: '700', tx_hash: '0xshort', payee_address: PAYEE },
        { id: 'p-wrong', chain: 'base', asset: 'USDC', amount_units: '700', tx_hash: '0xwrong', payee_address: PAYEE },
      ],
      receipts: {
        '0xrev': { status: 0, logs: [logTo(TREASURY, 500n)] },
        '0xshort': { status: 1, logs: [logTo(PAYEE, 699n)] },
        '0xwrong': { status: 1, logs: [logTo('0x' + '44'.repeat(20), 700n)] },
      },
    }));
    expect(r.findings.map((f) => f.ref).sort()).toEqual(['p-short', 'p-wrong', 's-missing', 's-nohash', 's-reverted']);
    expect(r.clean).toBe(false);
  });

  it('flags things stuck in flight as warnings, and reports what it could not check instead of calling it clean', async () => {
    const r = await reconcile(world({ stuck: { payout: [{ id: 'p9' }], sweep: [{ id: 's9' }] } }));
    expect(r.findings.map((f) => `${f.code}:${f.severity}`).sort()).toEqual(['stuck_payout:warning', 'stuck_sweep:warning']);
    const unreadable = await reconcile({ ...world({ deposits: [{ id: 'd1', chain: 'base', token: 'USDC', address: '0xaa', received_amount_units: '1' }] }), chain: () => null });
    expect(unreadable.clean).toBe(false);
    expect(unreadable.errors[0]).toMatch(/cannot read/);
  });

  it('transferred() requires success, the right token, recipient and enough units', () => {
    const ok = { status: 1, logs: [logTo(PAYEE, 10n)] };
    expect(transferred(ok, TOKEN, PAYEE, 10n)).toBe(true);
    expect(transferred(ok, TOKEN, PAYEE, 11n)).toBe(false);
    expect(transferred(ok, '0x' + '55'.repeat(20), PAYEE, 10n)).toBe(false);
    expect(transferred({ status: 0, logs: ok.logs }, TOKEN, PAYEE, 10n)).toBe(false);
  });
});
