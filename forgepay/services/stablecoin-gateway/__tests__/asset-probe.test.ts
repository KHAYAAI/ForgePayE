import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/events.js', () => ({ forwardToUnifiedRouter: async () => undefined }));
import { ethers } from 'ethers';
import { probeToken, type ProbeChain } from '../src/lib/asset-probe.js';
import { AssetRegistry, type AssetDef, type TokenReader } from '../src/lib/assets.js';
import { settleChainOnce, type SettlementChain } from '../src/lib/settlement.js';

const sel = (sig: string) => ethers.id(sig).slice(0, 10);
const w = (v: bigint | string) => '0x' + (typeof v === 'string' ? v.replace('0x', '').padStart(64, '0') : v.toString(16).padStart(64, '0'));
const TOKEN = '0x' + '11'.repeat(20);
const IMPL = '0x' + '22'.repeat(20);

/** A fake token: answers the selectors it is given, reverts on everything else. */
function fake(answers: Record<string, string>, storage: Record<string, string> = {}): ProbeChain {
  return {
    async call(_to, data) { const k = Object.keys(answers).find((s) => data.startsWith(sel(s))); return k ? answers[k]! : null; },
    async storageAt(_a, slot) { return storage[slot] ?? w(0n); },
  };
}

describe('first-contact probe', () => {
  it('finds nothing on a plain token', async () => {
    expect((await probeToken(fake({}), TOKEN)).findings).toEqual([]);
  });
  it('blocks a rebasing token, whichever of the usual signs it shows', async () => {
    for (const sig of ['sharesOf(address)', 'rebasingCreditsPerToken()', 'scaledBalanceOf(address)', 'gonsPerFragment()']) {
      const r = await probeToken(fake({ [sig]: w(5n) }), TOKEN);
      expect(r.findings.some((f) => f.level === 'block' && f.code === 'rebasing'), sig).toBe(true);
    }
  });
  it('blocks a paused token and notes a pausable one', async () => {
    expect((await probeToken(fake({ 'paused()': w(1n) }), TOKEN)).findings[0]).toMatchObject({ level: 'block', code: 'paused' });
    expect((await probeToken(fake({ 'paused()': w(0n) }), TOKEN)).findings[0]).toMatchObject({ level: 'info', code: 'pausable' });
  });
  it('flags proxies (with the implementation), freezing and fee-like settings for review', async () => {
    const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    const r = await probeToken(fake({ 'isBlacklisted(address)': w(0n), 'transferFeeBasisPoints()': w(25n) }, { [SLOT]: w(IMPL) }), TOKEN);
    expect(r.implementation?.toLowerCase()).toBe(IMPL);
    expect(r.findings.map((f) => f.code).sort()).toEqual(['fee-like', 'freezable', 'upgradeable']);
    expect(r.findings.every((f) => f.level === 'review')).toBe(true);
  });
});

describe('registry uses the probe', () => {
  const def: AssetDef = { symbol: 'OUSD', name: 'Open Standard USD', unit: 'USD', expectedSymbols: ['OUSD'], presetDecimals: 6, chains: { base: TOKEN } } as AssetDef;
  const reader = (probe: TokenReader['probe']): TokenReader => ({
    chainId: async () => 8453, hasCode: async () => true, symbol: async () => 'OUSD', decimals: async () => 6, probe,
  });
  it('refuses a rebasing asset unless an operator names it, and explains how', async () => {
    const rebasing = reader(async () => probeToken(fake({ 'sharesOf(address)': w(1n) }), TOKEN));
    const r1 = new AssetRegistry([def], rebasing, {});
    const [s1] = await r1.verify();
    expect(s1!.status).toBe('unavailable');
    expect(s1!.problem).toMatch(/rebasing/);
    expect(r1.get('OUSD', 'base')).toBeUndefined();
    const r2 = new AssetRegistry([def], rebasing, { ASSET_ALLOW_REBASING_OUSD: 'true' });
    expect((await r2.verify())[0]!.status).toBe('available');
  });
  it('reports an implementation change between two checks', async () => {
    const SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
    let impl = IMPL;
    const rd = reader(async () => probeToken(fake({}, { [SLOT]: w(impl) }), TOKEN));
    const reg = new AssetRegistry([def], rd, {});
    const seen: string[] = [];
    reg.onImplementationChange = (_s, _c, from, to) => seen.push(`${from}->${to}`);
    await reg.verify();
    expect(seen).toEqual([]);
    impl = '0x' + '33'.repeat(20);
    const [st] = await reg.verify();
    expect(seen).toHaveLength(1);
    expect(st!.findings!.some((f) => f.code === 'implementation-changed')).toBe(true);
  });
});

describe('settlement checks the real balance before crediting', () => {
  const asset = { symbol: 'USDC', name: 'USD Coin', chain: 'base', address: TOKEN, unit: 'USD', decimals: 6, verified: true } as any;
  const dep = { id: 'd1', address: '0x' + 'aa'.repeat(20), amount_units: '1000000', token: 'USDC', decimals: 6, chain: 'base', status: 'pending', expires_at: new Date(Date.now() + 3600_000).toISOString(),
    scan_cursor: null, scan_units: '0', late_units: '0', from_block: '100', tx_hash: null, received_amount_units: null, merchant_id: 'm', network: 'base' } as any;
  function run(balance: bigint) {
    const updates: string[] = [];
    const db: any = { async query(sql: string) {
      if (/FROM stablecoin_deposits/.test(sql) && /SELECT/.test(sql) && !/UPDATE/.test(sql)) return { rows: [dep] };
      if (/UPDATE stablecoin_deposits/.test(sql)) { updates.push(sql.includes("'confirmed'") ? 'confirmed' : 'other'); return { rows: [{ id: 'd1' }] }; }
      return { rows: [] };
    } };
    const chain: SettlementChain = {
      blockNumber: async () => 200,
      transfersTo: async () => [{ txHash: '0xabc', blockNumber: 150, value: 1_000_000n }],
      blockTime: async () => Math.floor(Date.now() / 1000) - 60,
      balanceOf: async () => balance,
    };
    const registry: any = { get: () => asset };
    return settleChainOnce('base', chain, db, registry, { confirmations: () => 12 }).then((r) => ({ r, updates }));
  }
  it('credits when the address holds what was paid', async () => {
    const { updates } = await run(1_000_000n);
    expect(updates).toContain('confirmed');
  });
  it('does not credit when the balance is short (fee-on-transfer / rebasing / lying events)', async () => {
    const { updates } = await run(990_000n);
    expect(updates).not.toContain('confirmed');
  });
});
