import { describe, it, expect } from 'vitest';
import { pollRate, feedConfig, createFeedRunner, frankfurter, openErApi, coinbase, type RateSource } from '../src/lib/fx-feed.js';
import { rateToScaled, scaledToRate } from '../src/lib/asset-math.js';
import { USD_ZAR, type RateStore, type StoredRate } from '../src/lib/fx.js';

const cfg = feedConfig({});
const src = (name: string, v: number | Error): RateSource => ({ name, fetch: async () => { if (v instanceof Error) throw v; return v; } });
const memStore = (initial?: string): RateStore & { puts: StoredRate[] } => {
  const puts: StoredRate[] = [];
  let cur: StoredRate | null = initial ? { pair: USD_ZAR, scaled: rateToScaled(initial), asOf: new Date(), source: 'x', setBy: 'op' } : null;
  return { puts, async latest() { return cur; }, async put(r) { cur = r; puts.push(r); } };
};

describe('USD/ZAR feed', () => {
  it('stores the median when enough sources agree', async () => {
    const o = await pollRate([src('a', 18.1), src('b', 18.12), src('c', 18.09)], cfg, null);
    expect(o.ok).toBe(true);
    expect(o.rate).toBe('18.100000');
  });
  it('refuses when too few sources answer', async () => {
    const o = await pollRate([src('a', 18.1), src('b', new Error('HTTP 500')), src('c', new Error('timeout'))], cfg, null);
    expect(o.ok).toBe(false);
    expect(o.reason).toMatch(/only 1 of 3/);
  });
  it('refuses when sources disagree', async () => {
    const o = await pollRate([src('a', 18.1), src('b', 19.5)], cfg, null);
    expect(o.ok).toBe(false);
    expect(o.reason).toMatch(/disagree/);
  });
  it('refuses nonsense and sudden jumps, and is clear about why', async () => {
    expect((await pollRate([src('a', 1.8), src('b', 1.8)], cfg, null)).reason).toMatch(/sanity range/);
    const jump = await pollRate([src('a', 20), src('b', 20.05)], cfg, 18);
    expect(jump.ok).toBe(false);
    expect(jump.reason).toMatch(/moved 11/);
    expect((await pollRate([src('a', 18.3), src('b', 18.31)], cfg, 18)).ok).toBe(true);
  });
  it('writes accepted rates to the store with the sources named, and leaves a refused one alone', async () => {
    const store = memStore('18.00');
    let failed = 0;
    const good = createFeedRunner(store, [src('a', 18.2), src('b', 18.21)], cfg, () => failed++);
    await good.runOnce();
    expect(store.puts).toHaveLength(1);
    expect(store.puts[0]!.source).toBe('feed:a+b (median)');
    expect(scaledToRate(store.puts[0]!.scaled)).toBe('18.205');
    const bad = createFeedRunner(store, [src('a', 30), src('b', 30)], cfg, () => failed++);
    await bad.runOnce();
    expect(store.puts).toHaveLength(1);
    expect(failed).toBe(1);
  });
  it('parses the providers\' documented response shapes', async () => {
    const sig = new AbortController().signal;
    expect(await frankfurter(async () => ({ amount: 1, base: 'USD', rates: { ZAR: 18.07 } })).fetch(sig)).toBe(18.07);
    expect(await openErApi(async () => ({ result: 'success', rates: { ZAR: 18.1 } })).fetch(sig)).toBe(18.1);
    expect(await coinbase(async () => ({ data: { currency: 'USD', rates: { ZAR: '18.09' } } })).fetch(sig)).toBe(18.09);
    await expect(openErApi(async () => ({ result: 'error', 'error-type': 'quota-reached' })).fetch(sig)).rejects.toThrow(/result=error/);
    await expect(frankfurter(async () => ({ rates: {} })).fetch(sig)).rejects.toThrow(/rates.ZAR/);
  });
});
