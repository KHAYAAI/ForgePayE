/**
 * Sanctions screening for KYC, through compliance-monitor.
 *
 * This replaces a stub that logged a warning and returned "no match" for
 * everyone, so enabling screening screened nobody. Every path that cannot
 * positively establish "no match against loaded, fresh lists" returns
 * `unavailable`, which the caller turns into manual review — never approval.
 *
 * compliance-monitor endpoints used (src/routers/sanctions.py there):
 *   GET /api/v1/sanctions/lists   list name, entry_count, age_hours
 *   GET /api/v1/sanctions/search  fuzzy name search across every loaded list
 * Its search returns [] when no list is loaded, which is why freshness is
 * checked first.
 */

export type ScreeningOutcome = 'clear' | 'possible_match' | 'match' | 'unavailable' | 'not_screened';

export interface ScreeningResult {
  outcome: ScreeningOutcome;
  detail:  string;
  matches: Array<{ list_name: string; matched_name: string; similarity_score: number }>;
}

export interface ScreeningConfig {
  baseUrl:      string | undefined;
  apiKey:       string | undefined;
  /** A list older than this is stale and screening is unavailable. */
  maxAgeHours:  number;
  /** At or above: treated as a match (rejected). Below, down to the search threshold: review. */
  matchScore:   number;
  searchThreshold: number;
}

type Fetch = typeof fetch;

export async function screenName(fullName: string, cfg: ScreeningConfig, doFetch: Fetch = fetch): Promise<ScreeningResult> {
  if (!cfg.baseUrl || !cfg.apiKey) {
    return { outcome: 'unavailable', detail: 'compliance-monitor is not configured', matches: [] };
  }
  const base = cfg.baseUrl.replace(/\/$/, '');
  const headers = { 'X-Compliance-API-Key': cfg.apiKey, Accept: 'application/json' };

  try {
    const listsRes = await doFetch(`${base}/api/v1/sanctions/lists`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!listsRes.ok) return { outcome: 'unavailable', detail: `sanctions lists: HTTP ${listsRes.status}`, matches: [] };
    const lists = (await listsRes.json()) as Array<{ list_name: string; entry_count: number; age_hours: number }>;
    if (!Array.isArray(lists) || lists.length === 0) {
      return { outcome: 'unavailable', detail: 'no sanctions lists reported', matches: [] };
    }
    const unusable = lists.filter((l) => !(l.entry_count > 0) || !(l.age_hours <= cfg.maxAgeHours));
    if (unusable.length > 0) {
      return {
        outcome: 'unavailable',
        detail: `sanctions lists empty or stale: ${unusable.map((l) => `${l.list_name} (${l.entry_count} entries, ${l.age_hours}h old)`).join(', ')}`,
        matches: [],
      };
    }

    const q = new URLSearchParams({ q: fullName, threshold: String(cfg.searchThreshold) });
    const searchRes = await doFetch(`${base}/api/v1/sanctions/search?${q}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!searchRes.ok) return { outcome: 'unavailable', detail: `sanctions search: HTTP ${searchRes.status}`, matches: [] };
    const matches = (await searchRes.json()) as ScreeningResult['matches'];
    if (!Array.isArray(matches)) return { outcome: 'unavailable', detail: 'sanctions search: unexpected response', matches: [] };

    const lists_ = lists.map((l) => l.list_name).join(', ');
    if (matches.length === 0) return { outcome: 'clear', detail: `no match on ${lists_}`, matches };
    const best = Math.max(...matches.map((m) => m.similarity_score));
    return {
      outcome: best >= cfg.matchScore ? 'match' : 'possible_match',
      detail: `${matches.length} hit(s) on ${lists_}, best ${best.toFixed(2)}`,
      matches,
    };
  } catch (err) {
    return { outcome: 'unavailable', detail: `sanctions screening failed: ${err instanceof Error ? err.message : String(err)}`, matches: [] };
  }
}
