/**
 * Real sanctions screening, delegated to compliance-monitor.
 *
 * `sanctionsScreen()` in verify.ts only ever counted `sanctions_hit` events
 * already recorded in the agent's own credit history and checked `frozenAt` —
 * both self-reported, neither backed by an actual list. An agent with no
 * recorded hit passed regardless of whether its operator or on-chain address
 * was actually sanctioned, because nothing here ever asked.
 *
 * compliance-monitor already ingests the real OFAC SDN and EU consolidated
 * lists and runs a working fuzzy-match screening engine
 * (`src/sanctions/screening.py`) behind `POST /api/v1/screening/{entity,address}`.
 * This module calls it instead of re-implementing sanctions screening here.
 *
 * Same fail-closed convention as forge-custody's `checkSanctions()`
 * (src/policy.ts): `COMPLIANCE_MONITOR_URL` unset refuses to boot the check in
 * production and passes with a logged warning in development — a bureau
 * silently treating "no screening service configured" as "clear" would be
 * worse than one that says so.
 *
 * ⚠️ forge-custody's existing integration was itself broken — wrong endpoint
 * path (`/api/v1/screen/address` vs the real `/api/v1/screening/address`),
 * wrong response shape (`{status}` vs the real `ScreeningResult.result`), and
 * no auth header at all, so every call 404'd/401'd and fell through to
 * `'error'`. It failed *closed* (custody rejects on `'error'`), so no unsafe
 * transaction went through — but every custody transfer above the sanctions
 * threshold was being unconditionally rejected whenever
 * COMPLIANCE_MONITOR_URL was set, which is its own kind of broken. Fixed
 * alongside this module so the platform has one correct integration, not two
 * different wrong ones.
 */

// ── compliance-monitor's real response contract ────────────────────────────
// Mirrors src/models.py::ScreeningResult in the compliance-monitor service.

export interface SanctionsMatch {
  list_name: string;
  matched_name: string;
  similarity_score: number;
  entry_id: string;
  entry_type: string;
  programs: string[];
}

export interface ScreeningResult {
  entity_id: string;
  entity_type: string;
  name: string;
  screened_at: string;
  result: 'clear' | 'potential_match' | 'confirmed_match' | 'error';
  matches: SanctionsMatch[];
  risk_score: number;
  recommended_action: 'allow' | 'review' | 'block';
}

export type ScreenOutcome =
  | { checked: true; clear: boolean; result: ScreeningResult }
  | { checked: false; clear: true; reason: 'not_configured_dev' }
  | { checked: false; clear: false; reason: 'not_configured_prod' | 'call_failed' };

function baseUrl(): string | undefined {
  return process.env['COMPLIANCE_MONITOR_URL'];
}

function authHeaders(): Record<string, string> {
  const key = process.env['COMPLIANCE_MONITOR_API_KEY'];
  return key ? { 'X-Compliance-API-Key': key } : {};
}

/**
 * Fail-closed gate shared by both screening calls below.
 *
 * @returns null when the caller should proceed with a real HTTP call, or a
 *          terminal ScreenOutcome when there is no service to call.
 */
function unconfiguredOutcome(kind: 'address' | 'entity'): ScreenOutcome | null {
  if (baseUrl()) return null;

  if (process.env['NODE_ENV'] === 'production') {
    console.error('[bureau] COMPLIANCE_MONITOR_URL not set in production — sanctions screen FAILS CLOSED', { kind });
    return { checked: false, clear: false, reason: 'not_configured_prod' };
  }
  console.warn('[bureau] COMPLIANCE_MONITOR_URL not set — sanctions screen SKIPPED (dev only)', { kind });
  return { checked: false, clear: true, reason: 'not_configured_dev' };
}

/** `clear` is true only for an explicit `allow` recommendation from the real engine. */
function isClear(result: ScreeningResult): boolean {
  return result.result === 'clear' && result.recommended_action === 'allow';
}

export async function screenAddress(address: string, chain = 'ETH'): Promise<ScreenOutcome> {
  const gated = unconfiguredOutcome('address');
  if (gated) return gated;

  try {
    const res = await fetch(`${baseUrl()!.replace(/\/$/, '')}/api/v1/screening/address`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ address, chain }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[bureau] address sanctions screen returned non-2xx', { address, status: res.status });
      return { checked: false, clear: false, reason: 'call_failed' };
    }
    const result = (await res.json()) as ScreeningResult;
    return { checked: true, clear: isClear(result), result };
  } catch (err) {
    console.error('[bureau] address sanctions screen call failed', { err, address });
    return { checked: false, clear: false, reason: 'call_failed' };
  }
}

export async function screenEntity(
  entityId: string,
  entityType: 'person' | 'business',
  name: string,
): Promise<ScreenOutcome> {
  const gated = unconfiguredOutcome('entity');
  if (gated) return gated;

  try {
    const res = await fetch(`${baseUrl()!.replace(/\/$/, '')}/api/v1/screening/entity`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ entity_id: entityId, entity_type: entityType, name }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.error('[bureau] entity sanctions screen returned non-2xx', { entityId, status: res.status });
      return { checked: false, clear: false, reason: 'call_failed' };
    }
    const result = (await res.json()) as ScreeningResult;
    return { checked: true, clear: isClear(result), result };
  } catch (err) {
    console.error('[bureau] entity sanctions screen call failed', { err, entityId });
    return { checked: false, clear: false, reason: 'call_failed' };
  }
}
