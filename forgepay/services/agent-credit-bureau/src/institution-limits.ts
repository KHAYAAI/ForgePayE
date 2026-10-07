/**
 * Per-institution limits: how fast an institution may call the API, and how many hard pulls it may make in a day.
 *
 * The global rate limit is per client address and runs before authentication, which is right for shedding floods but wrong for
 * an institution: two institutions behind one egress address share a budget, and one big lender cannot be given more than
 * another. These limits follow the institution (its key), are set by an operator, and are shown to the institution in response
 * headers so it can pace itself.
 *
 *   requestsPerMinute  fixed one-minute window, every authenticated request counts. Default INSTITUTION_RPM (600).
 *   maxPullsPerDay     hard pulls (reports) per UTC day; protects a lender from a runaway integration spending its balance.
 *
 * The request window lives in memory per process (like the rest of the read model), so with several replicas an institution
 * gets the limit on each. The daily pull count is kept on the institution's record, so it is durable and survives a restart.
 */

import type { DataContributor } from './types';

export interface InstitutionLimits {
  requestsPerMinute?: number;
  maxPullsPerDay?: number;
}

export const MAX_REQUESTS_PER_MINUTE = 100_000;
export const MAX_PULLS_PER_DAY = 100_000;

export function defaultRequestsPerMinute(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env['INSTITUTION_RPM'] ?? '600', 10);
  return Number.isFinite(n) && n > 0 ? n : 600;
}

interface Window { startedAt: number; count: number }
const windows = new Map<string, Window>();

export interface RateDecision { allowed: boolean; limit: number; remaining: number; resetInSeconds: number }

export function checkRate(institutionId: string, limits: InstitutionLimits | undefined, now = Date.now(), env: NodeJS.ProcessEnv = process.env): RateDecision {
  const limit = limits?.requestsPerMinute ?? defaultRequestsPerMinute(env);
  let w = windows.get(institutionId);
  if (!w || now - w.startedAt >= 60_000) {
    w = { startedAt: now, count: 0 };
    windows.set(institutionId, w);
  }
  const resetInSeconds = Math.max(1, Math.ceil((w.startedAt + 60_000 - now) / 1000));
  if (w.count >= limit) return { allowed: false, limit, remaining: 0, resetInSeconds };
  w.count += 1;
  return { allowed: true, limit, remaining: limit - w.count, resetInSeconds };
}

/** Test helper. */
export function __resetRateWindows(): void { windows.clear(); }

const utcDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface PullDecision { allowed: boolean; limit: number | null; used: number }

/** Has this institution reached its daily pull cap? No cap set means no limit. */
export function checkPullCap(c: Pick<DataContributor, 'limits' | 'pullsToday'>, now = Date.now()): PullDecision {
  const limit = c.limits?.maxPullsPerDay ?? null;
  const today = utcDay(now);
  const used = c.pullsToday && c.pullsToday.date === today ? c.pullsToday.count : 0;
  if (limit === null) return { allowed: true, limit, used };
  return { allowed: used < limit, limit, used };
}

/** Count one completed pull against today. Mutates the record; the caller persists it. */
export function recordPull(c: Pick<DataContributor, 'pullsToday'>, now = Date.now()): void {
  const today = utcDay(now);
  c.pullsToday = c.pullsToday && c.pullsToday.date === today
    ? { date: today, count: c.pullsToday.count + 1 }
    : { date: today, count: 1 };
}

export type LimitsParse =
  | { ok: true; value: InstitutionLimits; clear: Array<keyof InstitutionLimits> }
  | { ok: false; message: string };

/** Validate an operator's request. A key set to null clears that limit; a key left out is left alone. */
export function parseLimits(raw: unknown): LimitsParse {
  if (typeof raw !== 'object' || raw === null) return { ok: false, message: 'Send an object with requestsPerMinute and/or maxPullsPerDay.' };
  const r = raw as Record<string, unknown>;
  const value: InstitutionLimits = {};
  const clear: Array<keyof InstitutionLimits> = [];
  const spec: Array<[keyof InstitutionLimits, number, number]> = [
    ['requestsPerMinute', 1, MAX_REQUESTS_PER_MINUTE],
    ['maxPullsPerDay', 0, MAX_PULLS_PER_DAY],
  ];
  let any = false;
  for (const [key, min, max] of spec) {
    if (!(key in r)) continue;
    any = true;
    const v = r[key];
    if (v === null) { clear.push(key); continue; }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
      return { ok: false, message: `${key} must be a whole number from ${min} to ${max}, or null to remove the limit.` };
    }
    value[key] = v;
  }
  if (!any) return { ok: false, message: 'Send requestsPerMinute and/or maxPullsPerDay.' };
  const unknown = Object.keys(r).filter((k) => k !== 'requestsPerMinute' && k !== 'maxPullsPerDay');
  if (unknown.length) return { ok: false, message: `Unknown field: ${unknown.join(', ')}.` };
  return { ok: true, value, clear };
}
