/**
 * Didit company-register lookup, behind the `KybProvider` seam in kyb.ts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The two calls, and what each costs
 *
 *   search  POST {base}/v3/kyb/search/   free. Returns candidates with a short-lived handle (`kyb_response_id`).
 *   select  POST {base}/v3/kyb/select/   BILLED per company ($2.00 for the basic tier at the time of writing). Returns the record.
 *
 * So the order matters. We search first, decide from the candidates whether there is exactly one acceptable company, and only then pay to
 * select it. A search that finds nothing, finds the wrong number, or finds several never costs anything.
 *
 * Response shapes below were observed from Didit's sandbox application through its tools. The HTTP details (these paths, the `x-api-key`
 * header, the request field names) come from Didit's public documentation summaries and are NOT yet confirmed from here, because the
 * network of the machine that wrote this cannot reach Didit. `scripts/didit-kyb-smoke.mjs` checks them against the real API and must be
 * run before this is relied on. They are all in `ENDPOINTS` and `HEADER` so a correction is one line.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this refuses to do (every refusal is a fail-closed answer, never a "verified")
 *
 *   - Treat a sandbox answer as real. Didit's sandbox echoes whatever name it is given and calls it an active company. A sandbox key
 *     in production would therefore verify every operator. Sandbox responses are refused unless the environment is not production
 *     or DIDIT_ALLOW_SANDBOX=true is set on purpose.
 *   - Treat a company typed in by hand as registered: only records Didit marks as coming from the registry count.
 *   - Guess between several matches, or accept a number that belongs to a company with an unrelated name.
 *   - Spend without limit: selects are capped per rolling 24 hours (DIDIT_KYB_DAILY_MAX_SELECTS), repeated lookups are cached, and
 *     concurrent identical lookups share one paid call.
 *   - Turn an outage, a timeout, an odd response, a rejected key or an exhausted budget into a verdict on the company. Those are all
 *     `registry_unavailable`, which the policy already treats as retryable and not as a finding.
 *   - Log or echo the API key.
 */

import { readFileSync } from 'node:fs';
import type { KybProvider, KybQuery } from './kyb';
import { setKybProvider } from './kyb';
import type { OperatorVerification } from './types';

// ── The HTTP surface, in one place ───────────────────────────────────────────

export const ENDPOINTS = { search: '/v3/kyb/search/', select: '/v3/kyb/select/' } as const;
export const HEADER = 'x-api-key';
const DEFAULT_BASE = 'https://verification.didit.me';
const REGISTRY_LABEL = 'Didit company registry';

// ── Configuration ────────────────────────────────────────────────────────────

export interface DiditConfig {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  /** Refuse sandbox answers (the default in production). */
  refuseSandbox: boolean;
  /** Most billed selects in any rolling 24 hours. */
  dailyMaxSelects: number;
  cacheMs: number;
}

export class DiditConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'DiditConfigError'; }
}

const productionLike = (env: NodeJS.ProcessEnv) => {
  const v = (env['NODE_ENV'] ?? '').trim().toLowerCase();
  return v !== 'development' && v !== 'test';
};

const posInt = (raw: string | undefined, fallback: number, name: string): number => {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new DiditConfigError(`${name} must be a positive whole number.`);
  return n;
};

/** Null when Didit is not configured (the bureau then keeps its refusing default). Throws on a half-configured or unsafe setup. */
export function diditConfigFromEnv(env: NodeJS.ProcessEnv = process.env): DiditConfig | null {
  let key = '';
  const file = env['DIDIT_API_KEY_FILE'];
  if (file) {
    try { key = readFileSync(file, 'utf8').trim(); }
    catch (err) { throw new DiditConfigError(`DIDIT_API_KEY_FILE is set to ${file} but could not be read: ${err instanceof Error ? err.message : String(err)}`); }
  } else if (env['DIDIT_API_KEY']) {
    key = env['DIDIT_API_KEY'].trim();
  }
  if (!key) return null;

  const base = (env['DIDIT_BASE_URL'] ?? DEFAULT_BASE).replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(base); } catch { throw new DiditConfigError('DIDIT_BASE_URL is not a valid URL.'); }
  if (url.username || url.password) throw new DiditConfigError('DIDIT_BASE_URL must not contain credentials.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && !productionLike(env))) {
    throw new DiditConfigError('DIDIT_BASE_URL must be https (plain http is accepted only outside production).');
  }
  return {
    apiKey: key,
    baseUrl: url.origin + url.pathname.replace(/\/+$/, ''),
    timeoutMs: posInt(env['DIDIT_TIMEOUT_MS'], 20_000, 'DIDIT_TIMEOUT_MS'),
    refuseSandbox: productionLike(env) && env['DIDIT_ALLOW_SANDBOX'] !== 'true',
    dailyMaxSelects: posInt(env['DIDIT_KYB_DAILY_MAX_SELECTS'], 20, 'DIDIT_KYB_DAILY_MAX_SELECTS'),
    cacheMs: posInt(env['DIDIT_KYB_CACHE_MS'], 3_600_000, 'DIDIT_KYB_CACHE_MS'),
  };
}

// ── Matching ─────────────────────────────────────────────────────────────────

/** Registration numbers compare without punctuation or case: "2019/123456/07" and "2019123456 07" are the same number. */
export const normNumber = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

const LEGAL_FORM_WORDS = new Set(['pty', 'proprietary', 'ltd', 'limited', 'inc', 'incorporated', 'llc', 'corp', 'corporation', 'plc', 'co', 'company', 'the', 'sa', 'cc', 'npc', 'nv', 'bv', 'gmbh', 'ag']);

/** Names compare without case, accents, punctuation or the legal-form words that registers and operators spell differently. */
export function normName(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter((w) => w && !LEGAL_FORM_WORDS.has(w)).join(' ');
}

export const sameName = (a: string, b: string) => { const x = normName(a); return x.length > 0 && x === normName(b); };

// ── The provider ─────────────────────────────────────────────────────────────

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{
  status: number; text(): Promise<string>;
}>;

export interface DiditDeps { fetch?: FetchLike; now?: () => number }

class Unavailable extends Error {
  constructor(readonly note: string) { super(note); }
}

interface Candidate { kyb_response_id: string; name: string; registration_number: string; status: string }

export class DiditKybProvider implements KybProvider {
  readonly name = 'didit';
  private readonly doFetch: FetchLike;
  private readonly now: () => number;
  private selects: number[] = [];                              // timestamps of billed selects, for the rolling cap
  private cache = new Map<string, { at: number; v: OperatorVerification }>();
  private inFlight = new Map<string, Promise<OperatorVerification>>();

  constructor(private readonly cfg: DiditConfig, deps: DiditDeps = {}) {
    this.doFetch = deps.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.now = deps.now ?? Date.now;
  }

  /** How many billed selects remain in the current 24 hours. */
  selectsRemaining(): number {
    const cutoff = this.now() - 86_400_000;
    this.selects = this.selects.filter((t) => t > cutoff);
    return Math.max(0, this.cfg.dailyMaxSelects - this.selects.length);
  }

  async lookup(query: KybQuery): Promise<OperatorVerification> {
    const cc = query.countryCode.toUpperCase();
    const key = `${cc}|${query.registrationNumber ? normNumber(query.registrationNumber) : ''}|${query.legalName ? normName(query.legalName) : ''}`;

    const hit = this.cache.get(key);
    if (hit && this.now() - hit.at < this.cfg.cacheMs) return { ...hit.v, checkedAt: new Date(this.now()).toISOString() };

    const running = this.inFlight.get(key);
    if (running) return running;

    const p = this.run(cc, query).then((v) => {
      if (v.status === 'verified' || v.status === 'inactive') this.cache.set(key, { at: this.now(), v });
      return v;
    }).finally(() => { this.inFlight.delete(key); });
    this.inFlight.set(key, p);
    return p;
  }

  private result(status: OperatorVerification['status'], extra: Partial<OperatorVerification> = {}): OperatorVerification {
    return { status, checkedAt: new Date(this.now()).toISOString(), provider: this.name, ...extra };
  }

  private async run(cc: string, q: KybQuery): Promise<OperatorVerification> {
    try {
      const candidates = await this.search(cc, q);
      const pick = this.choose(candidates, q);
      if ('notFound' in pick) return this.result('not_found', { registry: `${REGISTRY_LABEL} (${cc})`, registryStatus: pick.notFound });
      const c = pick.candidate;
      if (c.status.toLowerCase() !== 'active') {
        // Judged from the free search: a company the register lists as anything but active is not in good standing, and costs nothing to say so.
        return this.result('inactive', { registry: `${REGISTRY_LABEL} (${cc})`, registeredName: c.name, registrationNumber: c.registration_number, registryStatus: c.status });
      }
      return await this.select(cc, q, c);
    } catch (err) {
      if (err instanceof Unavailable) return this.result('registry_unavailable', { registryStatus: err.note });
      return this.result('registry_unavailable', { registryStatus: 'unexpected error talking to the register' });
    }
  }

  // ── HTTP ───────────────────────────────────────────────────────────────────

  private async post(path: string, body: unknown): Promise<any> {
    let res;
    try {
      res = await this.doFetch(this.cfg.baseUrl + path, {
        method: 'POST', headers: { [HEADER]: this.cfg.apiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(this.cfg.timeoutMs),
      });
    } catch (err) {
      throw new Unavailable((err as Error)?.name === 'TimeoutError' ? 'the register did not answer in time' : 'the register could not be reached');
    }
    if (res.status === 401 || res.status === 403) throw new Unavailable('the register rejected our credentials');
    if (res.status === 429) throw new Unavailable('the register is rate limiting us');
    if (res.status < 200 || res.status >= 300) throw new Unavailable(`the register answered HTTP ${res.status}`);
    try { return JSON.parse(await res.text()); } catch { throw new Unavailable('the register returned an unreadable answer'); }
  }

  private async search(cc: string, q: KybQuery): Promise<Candidate[]> {
    const json = await this.post(ENDPOINTS.search, {
      country_code: cc,
      ...(q.registrationNumber ? { registration_number: q.registrationNumber } : {}),
      ...(q.legalName ? { name: q.legalName, search_type: 'contains' } : {}),
    });
    const reg = json?.kyb_registry;
    if (!reg || !Array.isArray(reg.companies)) throw new Unavailable('the register returned an answer in an unexpected form');
    if (reg.search_resolved !== true) throw new Unavailable('the register had not finished searching');
    const out: Candidate[] = [];
    for (const c of reg.companies) {
      if (typeof c?.kyb_response_id !== 'string' || typeof c?.name !== 'string' || typeof c?.registration_number !== 'string' || typeof c?.status !== 'string') {
        throw new Unavailable('the register returned a candidate in an unexpected form');
      }
      if (this.cfg.refuseSandbox && (c.kyb_response_id.startsWith('sandbox-') || c.registration_number.startsWith('SANDBOX-'))) {
        throw new Unavailable('the register answered from a sandbox, which is refused here');
      }
      out.push({ kyb_response_id: c.kyb_response_id, name: c.name, registration_number: c.registration_number, status: c.status });
    }
    return out;
  }

  /** Exactly one acceptable company, or a reason there is not. Never a guess. */
  private choose(cands: Candidate[], q: KybQuery): { candidate: Candidate } | { notFound: string } {
    let ok = cands;
    if (q.registrationNumber) {
      const want = normNumber(q.registrationNumber);
      ok = ok.filter((c) => normNumber(c.registration_number) === want);
      if (ok.length === 0) return { notFound: 'no company with that registration number' };
      if (q.legalName) {
        ok = ok.filter((c) => sameName(c.name, q.legalName!));
        if (ok.length === 0) return { notFound: 'name_mismatch: the number belongs to a company with a different name' };
      }
    } else if (q.legalName) {
      ok = ok.filter((c) => sameName(c.name, q.legalName!));
      if (ok.length === 0) return { notFound: 'no company with that name' };
    } else {
      return { notFound: 'nothing to search on' };
    }
    if (ok.length > 1) return { notFound: 'ambiguous: several companies match; supply the registration number' };
    return { candidate: ok[0]! };
  }

  private async select(cc: string, q: KybQuery, c: Candidate): Promise<OperatorVerification> {
    if (this.selectsRemaining() <= 0) throw new Unavailable('the daily limit on paid register lookups has been reached');
    this.selects.push(this.now());                                  // counted before the call: a lost reply may still have been billed
    const json = await this.post(ENDPOINTS.select, { kyb_response_id: c.kyb_response_id });
    const r = json?.kyb_registry;
    if (!r || typeof r !== 'object') throw new Unavailable('the register returned a record in an unexpected form');

    if (this.cfg.refuseSandbox && (r.registry_data?.sandbox === true || String(r.registration_number ?? '').startsWith('SANDBOX-'))) {
      throw new Unavailable('the register answered from a sandbox, which is refused here');
    }
    if (r.data_resolved !== true || r.fetch_status !== 'resolved') throw new Unavailable('the register had not finished retrieving the record');
    // A company typed in by hand is not a register record. Only registry-sourced records can verify anyone.
    if (r.is_from_registry !== true) throw new Unavailable('the record did not come from the register');
    if (typeof r.company_name !== 'string' || typeof r.registration_number !== 'string' || typeof r.registry_status !== 'string') {
      throw new Unavailable('the register returned a record with missing fields');
    }
    if (String(r.country_code ?? '').toUpperCase() !== cc) throw new Unavailable('the record is for a different country than asked');
    if (q.registrationNumber && normNumber(r.registration_number) !== normNumber(q.registrationNumber)) {
      throw new Unavailable('the record is for a different registration number than asked');
    }
    const base = { registry: `${REGISTRY_LABEL} (${cc})`, registeredName: r.company_name, registrationNumber: r.registration_number, registryStatus: r.registry_status };
    // Fail closed: only an explicit "active" verifies. Any other word, including ones we have not seen, leaves the company unverified.
    return r.registry_status.toLowerCase() === 'active' ? this.result('verified', base) : this.result('inactive', base);
  }
}

/** Install the Didit provider if (and only if) a key is configured. Called once at startup. */
export function installKybProvider(env: NodeJS.ProcessEnv = process.env, deps: DiditDeps = {}): { installed: boolean; provider?: string; note: string } {
  const cfg = diditConfigFromEnv(env);
  if (!cfg) return { installed: false, note: 'no company-register provider is configured; operator verification reports the register as unavailable' };
  setKybProvider(new DiditKybProvider(cfg, deps));
  return { installed: true, provider: 'didit', note: `Didit (${cfg.baseUrl}); at most ${cfg.dailyMaxSelects} paid lookups per 24h${cfg.refuseSandbox ? '' : '; SANDBOX ANSWERS ARE ACCEPTED'}` };
}
