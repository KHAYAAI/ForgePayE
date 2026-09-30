import { describe, it, expect } from 'vitest';
import {
  usdToMicro, rateToScaled, scaledToRate, usdMicroToUnits, unitsToDecimal, RATE_SCALE,
} from '../src/lib/asset-math.js';
import { AssetRegistry, loadAssetDefs, type TokenReader, DEFAULT_ASSETS } from '../src/lib/assets.js';
import { quoteFor, RateUnavailableError, type RateStore, type StoredRate } from '../src/lib/fx.js';

describe('asset math', () => {
  it('turns dollars into token units exactly, for any decimals', () => {
    const one = rateToScaled(1);
    expect(usdMicroToUnits(usdToMicro(25), one, 6, 'ceil')).toBe(25_000_000n);
    expect(usdMicroToUnits(usdToMicro(25), one, 18, 'ceil')).toBe(25n * 10n ** 18n);
    expect(usdMicroToUnits(usdToMicro(0.001), one, 6, 'ceil')).toBe(1_000n);
    expect(usdMicroToUnits(usdToMicro(12.34), one, 2, 'ceil')).toBe(1234n);
  });

  it('applies a rand rate: R18.42 to the dollar', () => {
    const zar = rateToScaled('18.42');
    expect(usdMicroToUnits(usdToMicro(100), zar, 18, 'ceil')).toBe(1842n * 10n ** 18n);
    // ZARP with 6 decimals would be 1842.000000
    expect(usdMicroToUnits(usdToMicro(100), zar, 6, 'ceil')).toBe(1_842_000_000n);
  });

  it('rounds money coming in up and money going out down, and they differ by at most one unit', () => {
    const rate = rateToScaled('18.42137891'); // eight places: the product can't be exact at 6 decimals
    const usd = usdToMicro(33.33);
    const up = usdMicroToUnits(usd, rate, 6, 'ceil');
    const down = usdMicroToUnits(usd, rate, 6, 'floor');
    expect(up - down).toBe(1n);
    // 33.33 × 18.42137891 = 613.9…: the floor is the truncation, the ceiling the next unit
    expect(unitsToDecimal(up, 6) > unitsToDecimal(down, 6)).toBe(true);
    expect(Number(unitsToDecimal(down, 6))).toBeCloseTo(33.33 * 18.42137891, 5);
    expect(usdMicroToUnits(usdToMicro(10), one(), 6, 'ceil')).toBe(usdMicroToUnits(usdToMicro(10), one(), 6, 'floor')); // exact when nothing to round
  });

  it('never loses precision that a float would', () => {
    // 0.1 + 0.2 style traps: 0.29 * 100 = 28.999999999999996 in floating point
    expect(usdToMicro(0.29)).toBe(290_000n);
    expect(usdToMicro(1.005)).toBe(1_005_000n);
    expect(usdMicroToUnits(usdToMicro(0.29), one(), 6, 'floor')).toBe(290_000n);
  });

  it('refuses amounts and rates it cannot represent', () => {
    for (const bad of [0, -1, NaN, Infinity, 1e-7]) expect(() => usdToMicro(bad)).toThrow();
    expect(() => usdToMicro(1.0000005)).toThrow(/decimal places/);
    for (const bad of ['0', '-1', 'abc', '1.123456789', '']) expect(() => rateToScaled(bad)).toThrow();
    expect(() => usdMicroToUnits(1n, one(), 99, 'ceil')).toThrow();
  });

  it('round-trips rates and formats units', () => {
    expect(scaledToRate(rateToScaled('18.42'))).toBe('18.42');
    expect(scaledToRate(RATE_SCALE)).toBe('1');
    expect(unitsToDecimal(1_500_000n, 6)).toBe('1.5');
    expect(unitsToDecimal(5n, 0)).toBe('5');
    expect(unitsToDecimal(10n ** 18n, 18)).toBe('1');
  });
});

function one() { return rateToScaled(1); }

// ── The registry ──────────────────────────────────────────────────────────────

const ZARP = '0xb755506531786C8aC63B756BaB1ac387bACB0C04';
const OUSD = '0xB2000000000000000000002fEb517dFeC7415344';
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

class FakeChain implements TokenReader {
  tokens = new Map<string, { symbol: string; decimals: number }>();
  chain = 8453;
  down = false;
  async chainId() { if (this.down) throw new Error('ECONNREFUSED'); return this.chain; }
  async hasCode(_c: string, a: string) { if (this.down) throw new Error('ECONNREFUSED'); return this.tokens.has(a.toLowerCase()); }
  async symbol(_c: string, a: string) { return this.tokens.get(a.toLowerCase())!.symbol; }
  async decimals(_c: string, a: string) { return this.tokens.get(a.toLowerCase())!.decimals; }
  add(address: string, symbol: string, decimals: number) { this.tokens.set(address.toLowerCase(), { symbol, decimals }); return this; }
}

const defs = () => loadAssetDefs({});

describe('AssetRegistry', () => {
  it('reads decimals from the chain instead of assuming them', async () => {
    const chain = new FakeChain().add(USDC_BASE, 'USDC', 6).add(ZARP, 'ZARP', 18).add(OUSD, 'OUSD', 6);
    const reg = new AssetRegistry(defs(), chain, {});
    await reg.verify();
    expect(reg.get('ZARP', 'base')).toMatchObject({ decimals: 18, verified: true, unit: 'ZAR', address: ZARP });
    expect(reg.get('OUSD', 'base')).toMatchObject({ decimals: 6, verified: true, unit: 'USD', address: OUSD });
    expect(reg.get('USDC', 'base')).toMatchObject({ decimals: 6, verified: true });
    const other = new FakeChain().add(USDC_BASE, 'USDC', 6).add(ZARP, 'ZARP', 6).add(OUSD, 'OUSD', 18);
    const reg2 = new AssetRegistry(defs(), other, {});
    await reg2.verify();
    expect(reg2.get('ZARP', 'base')!.decimals).toBe(6);
    expect(reg2.get('OUSD', 'base')!.decimals).toBe(18);
  });

  it('refuses an address whose contract calls itself something else (the two addresses swapped)', async () => {
    const chain = new FakeChain().add(USDC_BASE, 'USDC', 6).add(ZARP, 'OUSD', 18).add(OUSD, 'ZARP', 18);
    const reg = new AssetRegistry(defs(), chain, {});
    await reg.verify();
    expect(reg.get('ZARP', 'base')).toBeUndefined();
    expect(reg.get('OUSD', 'base')).toBeUndefined();
    expect(reg.whyNot('ZARP', 'base')).toMatch(/calls itself "OUSD", not ZARP/);
  });

  it('refuses an address with no contract, and an RPC on the wrong network', async () => {
    const empty = new FakeChain().add(USDC_BASE, 'USDC', 6);
    const reg = new AssetRegistry(defs(), empty, {});
    await reg.verify();
    expect(reg.get('ZARP', 'base')).toBeUndefined();
    expect(reg.whyNot('ZARP', 'base')).toMatch(/no contract at/);

    const wrong = new FakeChain().add(USDC_BASE, 'USDC', 6).add(ZARP, 'ZARP', 18);
    wrong.chain = 1;
    const reg2 = new AssetRegistry(defs(), wrong, {});
    await reg2.verify();
    expect(reg2.get('ZARP', 'base')).toBeUndefined();
    expect(reg2.whyNot('ZARP', 'base')).toMatch(/chain id 1, expected 8453/);
  });

  it('a pinned decimals value that disagrees with the contract disables the asset', async () => {
    const chain = new FakeChain().add(USDC_BASE, 'USDC', 6).add(ZARP, 'ZARP', 18);
    const reg = new AssetRegistry(defs(), chain, { ASSET_ZARP_BASE_DECIMALS: '6' });
    await reg.verify();
    expect(reg.get('ZARP', 'base')).toBeUndefined();
    expect(reg.whyNot('ZARP', 'base')).toMatch(/reports 18 decimals, configured 6/);
  });

  it('with the RPC down: USDC carries on unverified, ZARP and OUSD are unavailable', async () => {
    const chain = new FakeChain();
    chain.down = true;
    const reg = new AssetRegistry(defs(), chain, {});
    await reg.verify();
    expect(reg.get('USDC', 'base')).toMatchObject({ decimals: 6, verified: false });
    expect(reg.get('ZARP', 'base')).toBeUndefined();
    expect(reg.get('OUSD', 'base')).toBeUndefined();
    expect(reg.status().find((s) => s.symbol === 'ZARP')).toMatchObject({ status: 'unavailable' });
  });

  it('is unavailable until verified, then recovers when the chain does', async () => {
    const chain = new FakeChain();
    chain.down = true;
    const reg = new AssetRegistry(defs(), chain, {});
    expect(reg.whyNot('ZARP', 'base')).toMatch(/not been verified/);
    await reg.verify();
    chain.down = false;
    chain.add(USDC_BASE, 'USDC', 6).add(ZARP, 'ZARP', 18).add(OUSD, 'OUSD', 18);
    await reg.verify();
    expect(reg.get('ZARP', 'base')).toBeDefined();
  });

  it('honours env overrides: another address, "off", and ASSETS_ENABLED', () => {
    const other = '0x1111111111111111111111111111111111111111';
    const d = loadAssetDefs({ ASSET_ZARP_BASE: other, ASSET_USDC_ETHEREUM: 'off' });
    expect(d.find((x) => x.symbol === 'ZARP')!.chains['base']).toBe(other);
    expect(d.find((x) => x.symbol === 'USDC')!.chains['ethereum']).toBeUndefined();
    expect(loadAssetDefs({ ASSETS_ENABLED: 'USDC' }).map((x) => x.symbol)).toEqual(['USDC']);
    expect(() => loadAssetDefs({ ASSET_ZARP_BASE: 'nope' })).toThrow(/not an address/);
  });

  it('ships the addresses it was given', () => {
    expect(DEFAULT_ASSETS.find((d) => d.symbol === 'ZARP')!.chains['base']).toBe(ZARP);
    expect(DEFAULT_ASSETS.find((d) => d.symbol === 'OUSD')!.chains['base']).toBe(OUSD);
  });
});

// ── Rates ─────────────────────────────────────────────────────────────────────

class MemStore implements RateStore {
  rows: StoredRate[] = [];
  async latest(pair: string) { return [...this.rows].reverse().find((r) => r.pair === pair) ?? null; }
  async put(r: StoredRate) { this.rows.push(r); }
}

describe('quoteFor', () => {
  const now = new Date('2026-09-30T12:00:00Z');

  it('dollar tokens buy one token per dollar; OUSD honours a peg adjustment', async () => {
    const s = new MemStore();
    expect((await quoteFor('USDC', 'USD', s, now, {})).assetPerUsd).toBe(RATE_SCALE);
    expect((await quoteFor('OUSD', 'USD', s, now, {})).assetPerUsd).toBe(RATE_SCALE);
    const q = await quoteFor('OUSD', 'USD', s, now, { OUSD_USD_RATE: '0.99' });
    expect(q.assetPerUsd > RATE_SCALE).toBe(true); // a token worth $0.99 takes more than one per dollar
    expect(q.source).toBe('OUSD_USD_RATE');
  });

  it('ZARP needs a rand rate, and refuses without one', async () => {
    await expect(quoteFor('ZARP', 'ZAR', new MemStore(), now, {})).rejects.toBeInstanceOf(RateUnavailableError);
  });

  it('uses the latest rate, and refuses a stale or future-dated one', async () => {
    const s = new MemStore();
    await s.put({ pair: 'USD/ZAR', scaled: rateToScaled('18'), asOf: new Date('2026-09-30T08:00:00Z'), source: 'ops', setBy: 'a' });
    await s.put({ pair: 'USD/ZAR', scaled: rateToScaled('18.5'), asOf: new Date('2026-09-30T11:00:00Z'), source: 'ops', setBy: 'a' });
    expect((await quoteFor('ZARP', 'ZAR', s, now, {})).rate).toBe('18.5');
    await expect(quoteFor('ZARP', 'ZAR', s, new Date('2026-10-02T12:00:00Z'), {})).rejects.toThrow(/set .*h ago/);
    await expect(quoteFor('ZARP', 'ZAR', s, new Date('2026-09-30T10:00:00Z'), {})).rejects.toThrow(/future/);
  });
});
