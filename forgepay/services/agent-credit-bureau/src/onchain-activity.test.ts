/**
 * Mode 2 activity indexer. Unit tests use a fake chain so every block range, cursor move and failure is deterministic; the
 * database test (skipped without DATABASE_URL, run in CI against Postgres) restarts the store for real and checks the
 * indexer resumes from its saved cursor and does not count anything twice.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  activityFor, activityInputs, applyTransfers, DEFAULT_LIMITS, emptySummary, hydrateActivity, indexWallet, limitsFromEnv, parseChains,
  resetActivity, runIndexerPass, setActivityPersistence, toCents,
  type ActivitySummary, type ChainConfig, type ChainSource, type RawTransfer, type TokenConfig,
} from './onchain-activity';
import { computeMode2Score } from './scorer';

const USDC: TokenConfig = { symbol: 'USDC', address: '0x' + 'a'.repeat(40), decimals: 6 };
const ME = '0x' + '1'.repeat(40);
const other = (n: number) => '0x' + n.toString(16).padStart(40, '0');
const ZERO = '0x' + '0'.repeat(40);

const CFG: ChainConfig = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.example.org', startBlock: 100, confirmations: 10, maxBlockRange: 50, tokens: [USDC] };
const usd = (n: number) => BigInt(Math.round(n * 1e6));
const tx = (blockNumber: number, from: string, to: string, dollars: number, logIndex = 0): RawTransfer => ({ blockNumber, logIndex, from, to, value: usd(dollars) });

/** A chain with a fixed head, a list of transfers, and a record of every range asked for. */
function fakeChain(head: number, all: RawTransfer[], opts: { failOn?: (from: number, to: number) => Error | null; timestampFails?: () => boolean } = {}) {
  const calls: Array<[number, number]> = [];
  const source: ChainSource = {
    head: async () => head,
    transfers: async (_t, _w, from, to) => {
      calls.push([from, to]);
      const err = opts.failOn?.(from, to);
      if (err) throw err;
      return all.filter((x) => x.blockNumber >= from && x.blockNumber <= to);
    },
    blockTimestamp: async (n) => { if (opts.timestampFails?.()) throw new Error('timestamp rpc down'); return 1_700_000_000 + n * 2; },
  };
  return { source, calls };
}

beforeEach(() => { resetActivity(); setActivityPersistence(null); });

describe('configuration', () => {
  const good = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.example.org', startBlock: 1, tokens: [{ symbol: 'USDC', address: '0x' + 'A'.repeat(40), decimals: 6 }] };
  it('accepts a valid chain, lower-cases addresses and applies defaults', () => {
    const [c] = parseChains(JSON.stringify([good]));
    expect(c).toMatchObject({ chainId: 8453, confirmations: 12, maxBlockRange: 2000 });
    expect(c!.tokens[0]!.address).toBe('0x' + 'a'.repeat(40));
  });
  it('refuses missing, malformed, duplicate and token-less configuration, naming the problem', () => {
    expect(() => parseChains(undefined)).toThrow(/required/);
    expect(() => parseChains('nope')).toThrow(/not valid JSON/);
    expect(() => parseChains('[]')).toThrow(/non-empty/);
    expect(() => parseChains(JSON.stringify([{ ...good, rpcUrl: 'ftp://x' }]))).toThrow(/rpcUrl/);
    expect(() => parseChains(JSON.stringify([{ ...good, tokens: [] }]))).toThrow(/at least one/);
    expect(() => parseChains(JSON.stringify([{ ...good, tokens: [{ symbol: 'X', address: '0x12', decimals: 6 }] }]))).toThrow(/valid address/);
    expect(() => parseChains(JSON.stringify([{ ...good, startBlock: -1 }]))).toThrow(/startBlock/);
    expect(() => parseChains(JSON.stringify([good, good]))).toThrow(/twice/);
  });
  it('takes limit overrides only when they are positive integers', () => {
    expect(limitsFromEnv({ ONCHAIN_MIN_TRANSFERS: '9', ONCHAIN_MIN_COUNTERPARTIES: 'x', ONCHAIN_DUST_CENTS: '0' } as any)).toEqual({ minTransfers: 9, minCounterparties: 3, dustCents: 1 });
  });
});

describe('what counts as activity', () => {
  it('converts token units to USD cents for any number of decimals', () => {
    expect(toCents(usd(12.34), 6)).toBe(1234);
    expect(toCents(5n, 0)).toBe(500);
    expect(toCents(123n, 2)).toBe(123);
    expect(toCents(10n ** 40n, 6)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('ignores self-transfers, mints and burns, transfers between others, and dust; counts both directions', () => {
    const s = emptySummary(ME, CFG);
    const lowest = applyTransfers(s, ME, USDC, [
      tx(120, ME, ME, 500),               // to oneself
      tx(121, ZERO, ME, 500),             // mint
      tx(122, ME, ZERO, 500),             // burn
      tx(123, other(8), other(9), 500),   // does not involve the wallet
      tx(124, other(2), ME, 0.001),       // dust
      tx(130, other(2), ME, 10),          // in
      tx(131, ME, other(3), 4.5),         // out
    ], DEFAULT_LIMITS);
    expect(s).toMatchObject({ transferCount: 2, inboundCount: 1, outboundCount: 1, volumeCents: 1450 });
    expect(s.counterparties.sort()).toEqual([other(2), other(3)].sort());
    expect(lowest).toBe(130);
  });

  it('matches the wallet case-insensitively', () => {
    const s = emptySummary(ME.toUpperCase().replace('0X', '0x'), CFG);
    applyTransfers(s, ME.toUpperCase().replace('0X', '0x'), USDC, [tx(130, other(2), ME, 10)], DEFAULT_LIMITS);
    expect(s.transferCount).toBe(1);
  });
});

describe('indexing a wallet', () => {
  it('reads in bounded ranges and stops short of the head by the confirmation depth', async () => {
    const { source, calls } = fakeChain(300, [tx(150, other(2), ME, 10)]);
    const r = await indexWallet(source, CFG, ME, undefined, DEFAULT_LIMITS, 100);
    expect(calls[0]).toEqual([100, 149]);
    expect(Math.max(...calls.map(([, to]) => to))).toBe(290);          // 300 head - 10 confirmations
    expect(calls.every(([f, t]) => t - f + 1 <= 50)).toBe(true);
    expect(r.summary.cursor).toBe(290);
    expect(r.complete).toBe(true);
  });

  it('a transfer inside the unconfirmed tail is not counted until it is confirmed', async () => {
    const chain = [tx(295, other(2), ME, 10)];
    const first = await indexWallet(fakeChain(300, chain).source, CFG, ME, undefined, DEFAULT_LIMITS, 100);
    expect(first.summary.transferCount).toBe(0);
    const later = await indexWallet(fakeChain(320, chain).source, CFG, ME, first.summary, DEFAULT_LIMITS, 100);
    expect(later.summary.transferCount).toBe(1);
  });

  it('records when the wallet was first seen from the earliest qualifying block', async () => {
    const { source } = fakeChain(300, [tx(210, other(3), ME, 5), tx(130, other(2), ME, 5)]);
    const r = await indexWallet(source, CFG, ME, undefined, DEFAULT_LIMITS, 100);
    expect(r.summary.firstSeenBlock).toBe(130);
    expect(r.summary.firstSeenAt).toBe(new Date((1_700_000_000 + 130 * 2) * 1000).toISOString());
  });

  it('resumes from the cursor and never counts a transfer twice', async () => {
    const chain = [tx(130, other(2), ME, 10), tx(250, other(3), ME, 20)];
    const half = await indexWallet(fakeChain(300, chain).source, CFG, ME, undefined, DEFAULT_LIMITS, 2);   // two calls only
    expect(half.complete).toBe(false);
    expect(half.summary.cursor).toBe(199);
    const { source, calls } = fakeChain(300, chain);
    const done = await indexWallet(source, CFG, ME, half.summary, DEFAULT_LIMITS, 100);
    expect(calls[0]![0]).toBe(200);                                     // started after the cursor
    expect(done.summary).toMatchObject({ transferCount: 2, volumeCents: 3000 });
    const again = await indexWallet(source, CFG, ME, done.summary, DEFAULT_LIMITS, 100);
    expect(again.summary.transferCount).toBe(2);                         // nothing new, nothing recounted
    expect(again.advanced).toBe(false);
  });

  it('halves the range when the provider refuses it, and still reads everything', async () => {
    const { source, calls } = fakeChain(300, [tx(130, other(2), ME, 10)], {
      failOn: (f, t) => (t - f + 1 > 10 ? new Error('query exceeds max block range') : null),
    });
    const r = await indexWallet(source, CFG, ME, undefined, DEFAULT_LIMITS, 500);
    expect(r.summary.lastError).toBeNull();
    expect(r.summary.transferCount).toBe(1);
    expect(calls.some(([f, t]) => t - f + 1 <= 10)).toBe(true);
  });

  it('on any other failure keeps the cursor where it was and reports the error', async () => {
    const chain = [tx(130, other(2), ME, 10), tx(250, other(3), ME, 20)];
    const { source } = fakeChain(300, chain, { failOn: (f) => (f >= 150 ? new Error('rpc 502') : null) });
    const r = await indexWallet(source, CFG, ME, undefined, DEFAULT_LIMITS, 100);
    expect(r.summary.lastError).toBe('rpc 502');
    expect(r.summary.cursor).toBe(149);
    expect(r.summary.transferCount).toBe(1);                              // only the range that was read in full
    const ok = await indexWallet(fakeChain(300, chain).source, CFG, ME, r.summary, DEFAULT_LIMITS, 100);
    expect(ok.summary).toMatchObject({ transferCount: 2, lastError: null });
  });

  it('a failure after a batch was read (the timestamp lookup) does not leave it counted twice', async () => {
    const chain = [tx(130, other(2), ME, 10)];
    let failing = true;
    const { source } = fakeChain(300, chain, { timestampFails: () => failing });
    const bad = await indexWallet(source, CFG, ME, undefined, DEFAULT_LIMITS, 100);
    expect(bad.summary.cursor).toBe(99);
    expect(bad.summary.transferCount).toBe(0);                            // the batch was not committed
    failing = false;
    const good = await indexWallet(source, CFG, ME, bad.summary, DEFAULT_LIMITS, 100);
    expect(good.summary.transferCount).toBe(1);                           // counted exactly once
  });

  it('spends a bounded number of calls per pass so one new wallet cannot starve the rest', async () => {
    const { source, calls } = fakeChain(100_000, []);
    const r = await indexWallet(source, CFG, ME, undefined, DEFAULT_LIMITS, 5);
    expect(calls).toHaveLength(5);
    expect(r.complete).toBe(false);
  });
});

describe('what Mode 2 gets', () => {
  const baseSummary = (over: Partial<ActivitySummary>): ActivitySummary => ({ ...emptySummary(ME, CFG), indexedAt: '2026-10-07T00:00:00.000Z', cursor: 5000, ...over });

  it('says so when the wallet has not been read yet', () => {
    expect(activityInputs(ME, [CFG])).toMatchObject({ ok: false, reason: 'not_indexed_yet' });
  });

  it('refuses to score thin history, saying what is missing', () => {
    hydrateActivity([baseSummary({ transferCount: 4, counterparties: [other(2), other(3), other(4)], firstSeenAt: '2026-01-01T00:00:00.000Z' })]);
    expect(activityInputs(ME, [CFG])).toMatchObject({ ok: false, reason: 'insufficient_history', detail: expect.stringContaining('found 4 with 3') });
    hydrateActivity([baseSummary({ transferCount: 50, counterparties: [other(2)], firstSeenAt: '2026-01-01T00:00:00.000Z' })]);
    expect(activityInputs(ME, [CFG])).toMatchObject({ ok: false, reason: 'insufficient_history' });
  });

  it('combines chains: totals add, counterparties are unioned, the earliest first-seen wins, provenance names each chain and block', () => {
    hydrateActivity([
      baseSummary({ transferCount: 4, volumeCents: 10_000, counterparties: [other(2), other(3)], firstSeenAt: '2026-03-01T00:00:00.000Z' }),
      baseSummary({ chainId: 1, cursor: 9000, transferCount: 3, volumeCents: 5_000, counterparties: [other(3), other(4)], firstSeenAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    const eth: ChainConfig = { ...CFG, chainId: 1, name: 'Ethereum' };
    const r = activityInputs(ME, [CFG, eth]);
    expect(r).toMatchObject({ ok: true, totalCount: 7, totalVolumeUsd: 150, counterparties: 3, firstSeenAt: '2026-01-01T00:00:00.000Z' });
    if (r.ok) expect(r.provenance.map((p) => `${p.name}@${p.indexedToBlock}`).sort()).toEqual(['Base@5000', 'Ethereum@9000']);
  });
});

describe('the scorer with an unknown success rate', () => {
  const inputs = (successRateBps: number | null) => ({
    successRateBps, totalVolumeUsd: 50_000, totalCount: 200, budgetComplianceRate: null,
    accountAgeMonths: 14, accountAgeSource: 'on-chain' as const, onChainSettled: false,
  });
  it('leaves the factor out, says so, and does not read the gap as a bad score', () => {
    const r = computeMode2Score(inputs(null));
    if (r.score === null) throw new Error('expected a score');
    expect(r.factors.find((f) => f.code === 'SUCCESS_RATE_UNKNOWN')).toMatchObject({ weight: 0 });
    expect(r.factors.some((f) => /SUCCESS_RATE$/.test(f.code))).toBe(false);
    const measuredBad = computeMode2Score(inputs(5000));
    expect(measuredBad.score).not.toBeNull();
    expect(r.score).toBeGreaterThan(measuredBad.score as number);         // unmeasured is not treated as failing
  });
  it('still scores a measured rate as before', () => {
    const r = computeMode2Score(inputs(9900));
    expect(r.factors.some((f) => f.code === 'HIGH_SUCCESS_RATE')).toBe(true);
  });
});

describe('a pass over all wallets', () => {
  it('saves what it read, and a wallet or chain that fails does not stop the others', async () => {
    const saved: string[] = [];
    setActivityPersistence({ save: async (s) => { saved.push(`${s.chainId}:${s.address.slice(0, 4)}:${s.transferCount}`); } });
    const good = fakeChain(300, [tx(130, other(2), ME, 10)]);
    const bad = fakeChain(300, [], { failOn: () => new Error('chain down') });
    const eth: ChainConfig = { ...CFG, chainId: 1, name: 'Ethereum' };
    await runIndexerPass({ chains: [CFG, eth], sources: new Map([[8453, good.source], [1, bad.source]]), listWallets: () => [ME] });
    expect(activityFor(ME).find((s) => s.chainId === 8453)).toMatchObject({ transferCount: 1, lastError: null });
    expect(activityFor(ME).find((s) => s.chainId === 1)?.lastError).toBe('chain down');
    expect(saved).toContain('8453:0x11:1');
  });

  it('does not rewrite a summary that has not changed', async () => {
    let writes = 0;
    setActivityPersistence({ save: async () => { writes += 1; } });
    const { source } = fakeChain(300, [tx(130, other(2), ME, 10)]);
    const deps = { chains: [CFG], sources: new Map([[8453, source]]), listWallets: () => [ME] };
    await runIndexerPass(deps); const after = writes;
    await runIndexerPass(deps);
    expect(writes).toBe(after);
  });
});

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? describe : describe.skip;

dbSuite('against a real database', () => {
  type Store = typeof import('./store');
  type Db = typeof import('./db');
  let store: Store; let db: Db;
  const SAVED = { ...process.env };
  beforeAll(async () => {
    store = await import('./store'); db = await import('./db');
    await store.initPersistence();
    await db.pool.query('TRUNCATE onchain_activity');
  });
  afterEach(() => { process.env = { ...SAVED }; });
  afterAll(async () => { setActivityPersistence(null); await db.pool.query('TRUNCATE onchain_activity'); await db.pool.end(); });

  it('resumes after a restart from the saved cursor without reading or counting anything again', async () => {
    await store.initPersistence();                                       // installs the write-through hook
    const chain = [tx(130, other(2), ME, 10), tx(250, other(3), ME, 20)];
    const first = fakeChain(300, chain);
    await runIndexerPass({ chains: [CFG], sources: new Map([[8453, first.source]]), listWallets: () => [ME] });
    expect(activityFor(ME)[0]).toMatchObject({ transferCount: 2, cursor: 290 });
    await new Promise((r) => setTimeout(r, 300));                        // write-through is asynchronous

    resetActivity();                                                     // the pod restarts: memory is gone
    expect(activityFor(ME)).toHaveLength(0);
    await store.initPersistence();
    expect(activityFor(ME)[0]).toMatchObject({ transferCount: 2, cursor: 290, volumeCents: 3000 });

    const second = fakeChain(300, chain);
    await runIndexerPass({ chains: [CFG], sources: new Map([[8453, second.source]]), listWallets: () => [ME] });
    expect(second.calls).toHaveLength(0);                                // already at the safe head: nothing re-read
    expect(activityFor(ME)[0]!.transferCount).toBe(2);
  });
});
