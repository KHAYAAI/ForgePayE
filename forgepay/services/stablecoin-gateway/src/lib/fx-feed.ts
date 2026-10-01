/**
 * A live USD/ZAR feed that writes into the same rate store an operator uses by hand.
 *
 * A wrong rand rate is money lost on every ZARP payment, so a feed is not trusted just because it
 * answered:
 *   - it needs at least FX_FEED_MIN_SOURCES (default 2) independent sources to answer;
 *   - they must agree within FX_FEED_TOLERANCE_PCT (default 1%), else nothing is stored;
 *   - the median is used, and must sit inside sanity bounds (FX_FEED_MIN / FX_FEED_MAX, default 5–60);
 *   - a move of more than FX_FEED_MAX_JUMP_PCT (default 5%) from the last stored rate is refused and
 *     alerted, because a feed glitch looks exactly like that; an operator can set the rate by hand
 *     (PUT /assets/rates/USD-ZAR) to accept a real move.
 * When the feed is refused or down, the last rate simply ages and the existing max-age rule stops ZARP
 * quoting — it fails closed, and the watchdog alerts as it approaches that.
 *
 * The source URLs and response shapes below are the providers' documented public APIs. They have not
 * been exercised from this build environment (no outbound access); the parsers are tested against
 * the documented shapes, and `GET /assets/rates/feed/check` runs them live from wherever the gateway runs.
 */
import { rateToScaled, scaledToRate } from './asset-math.js';
import { USD_ZAR, type RateStore } from './fx.js';

export interface RateSource {
  name: string;
  /** Fetch USD->ZAR as a decimal number. */
  fetch(signal: AbortSignal): Promise<number>;
}

type FetchJson = (url: string, signal: AbortSignal) => Promise<any>;

const defaultFetchJson: FetchJson = async (url, signal) => {
  const r = await fetch(url, { signal, headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

const num = (v: unknown, what: string): number => {
  const n = typeof v === 'string' ? Number(v) : (v as number);
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) throw new Error(`${what} is not a positive number`);
  return n;
};

/** European Central Bank reference rates via Frankfurter. Published once per working day. */
export const frankfurter = (get: FetchJson = defaultFetchJson, base = 'https://api.frankfurter.dev'): RateSource => ({
  name: 'frankfurter',
  async fetch(signal) {
    const j = await get(`${base}/v1/latest?base=USD&symbols=ZAR`, signal);
    return num(j?.rates?.ZAR, 'rates.ZAR');
  },
});

/** open.er-api.com (ExchangeRate-API open access). */
export const openErApi = (get: FetchJson = defaultFetchJson, base = 'https://open.er-api.com'): RateSource => ({
  name: 'open-er-api',
  async fetch(signal) {
    const j = await get(`${base}/v6/latest/USD`, signal);
    if (j?.result && j.result !== 'success') throw new Error(`result=${j.result}`);
    return num(j?.rates?.ZAR, 'rates.ZAR');
  },
});

/** Coinbase's public exchange-rates endpoint. */
export const coinbase = (get: FetchJson = defaultFetchJson, base = 'https://api.coinbase.com'): RateSource => ({
  name: 'coinbase',
  async fetch(signal) {
    const j = await get(`${base}/v2/exchange-rates?currency=USD`, signal);
    return num(j?.data?.rates?.ZAR, 'data.rates.ZAR');
  },
});

export interface FeedConfig {
  minSources: number;
  tolerancePct: number;
  min: number;
  max: number;
  maxJumpPct: number;
}

export function feedConfig(env: NodeJS.ProcessEnv = process.env): FeedConfig {
  const n = (k: string, d: number) => { const v = Number(env[k] ?? d); return Number.isFinite(v) && v > 0 ? v : d; };
  return { minSources: Math.max(1, Math.floor(n('FX_FEED_MIN_SOURCES', 2))), tolerancePct: n('FX_FEED_TOLERANCE_PCT', 1), min: n('FX_FEED_MIN', 5), max: n('FX_FEED_MAX', 60), maxJumpPct: n('FX_FEED_MAX_JUMP_PCT', 5) };
}

export interface FeedOutcome {
  ok: boolean;
  rate?: string;
  sources: Array<{ name: string; rate?: number; error?: string }>;
  reason?: string;
}

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Query the sources and decide whether there is a rate worth storing. Pure apart from the sources. */
export async function pollRate(sources: RateSource[], cfg: FeedConfig, last: number | null, timeoutMs = 8000): Promise<FeedOutcome> {
  const results = await Promise.all(sources.map(async (s) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try { return { name: s.name, rate: await s.fetch(ctl.signal) }; }
    catch (e) { return { name: s.name, error: e instanceof Error ? e.message : String(e) }; }
    finally { clearTimeout(t); }
  }));
  const good = results.filter((r): r is { name: string; rate: number } => r.rate !== undefined);
  const out: FeedOutcome = { ok: false, sources: results };
  if (good.length < cfg.minSources) { out.reason = `only ${good.length} of ${sources.length} sources answered; ${cfg.minSources} are required`; return out; }
  const med = median(good.map((g) => g.rate));
  const wild = good.filter((g) => Math.abs(g.rate - med) / med * 100 > cfg.tolerancePct);
  if (wild.length) { out.reason = `sources disagree by more than ${cfg.tolerancePct}%: ${good.map((g) => `${g.name}=${g.rate}`).join(', ')}`; return out; }
  if (med < cfg.min || med > cfg.max) { out.reason = `the rate ${med} is outside the sanity range ${cfg.min}–${cfg.max}`; return out; }
  if (last !== null && Math.abs(med - last) / last * 100 > cfg.maxJumpPct) {
    out.reason = `the rate moved ${(((med - last) / last) * 100).toFixed(2)}% from the last stored ${last} (limit ${cfg.maxJumpPct}%); an operator should confirm by setting it by hand`;
    return out;
  }
  out.ok = true; out.rate = med.toFixed(6);
  return out;
}

export interface FeedRunner {
  runOnce(): Promise<FeedOutcome>;
  lastOutcome(): (FeedOutcome & { at: string }) | null;
}

export function createFeedRunner(store: RateStore, sources: RateSource[], cfg: FeedConfig, onFailure?: (o: FeedOutcome) => void, onSuccess?: () => void): FeedRunner {
  let last: (FeedOutcome & { at: string }) | null = null;
  return {
    lastOutcome: () => last,
    async runOnce() {
      const prev = await store.latest(USD_ZAR);
      const prevNum = prev ? Number(scaledToRate(prev.scaled)) : null;
      const o = await pollRate(sources, cfg, prevNum);
      last = { ...o, at: new Date().toISOString() };
      if (o.ok && o.rate) {
        await store.put({ pair: USD_ZAR, scaled: rateToScaled(o.rate), asOf: new Date(), source: `feed:${o.sources.filter((s) => s.rate !== undefined).map((s) => s.name).join('+')} (median)`, setBy: 'fx-feed' });
        onSuccess?.();
      } else {
        console.warn(`[fx-feed] not stored: ${o.reason}`);
        onFailure?.(o);
      }
      return o;
    },
  };
}

export function feedSourcesFromEnv(env: NodeJS.ProcessEnv = process.env): RateSource[] {
  const names = (env['FX_FEED_SOURCES'] ?? 'frankfurter,open-er-api,coinbase').split(',').map((s) => s.trim()).filter(Boolean);
  const all: Record<string, () => RateSource> = { 'frankfurter': () => frankfurter(), 'open-er-api': () => openErApi(), 'coinbase': () => coinbase() };
  return names.map((n) => { const f = all[n]; if (!f) throw new Error(`unknown FX_FEED_SOURCES entry "${n}" (known: ${Object.keys(all).join(', ')})`); return f(); });
}

export function startFeed(runner: FeedRunner, intervalMs: number, shouldRun?: () => boolean): { stop: () => void } {
  let running = false;
  const tick = async () => {
    if (running || shouldRun?.() === false) return;
    running = true;
    try { await runner.runOnce(); } catch (e) { console.error('[fx-feed] pass failed:', e instanceof Error ? e.message : e); } finally { running = false; }
  };
  const t = setInterval(() => { void tick(); }, intervalMs);
  t.unref?.();
  void tick();
  return { stop: () => clearInterval(t) };
}
