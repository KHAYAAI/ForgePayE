/**
 * FORGE Custody policy engine.
 *
 * Every signing request is evaluated against the workspace's enabled
 * policies BEFORE any key material is touched. A single violation rejects
 * the request with a specific reason code. Approval-threshold rules do not
 * reject — they gate the request behind multi-party approval.
 */

import { logger } from './lib/logger';
import { policyViolationsTotal } from './lib/metrics';
import { keys, policiesForWorkspace, usdSignedToday } from './store';
import type { PolicyDecision, SigningMetadata, TransactionPayload } from './types';

export interface PolicyInput {
  workspaceId: string;
  keyId: string;
  blockchain: string;
  amountUsd: number;
  transaction: TransactionPayload;
  metadata: SigningMetadata;
}

// compliance-monitor's real response contract (src/models.py::ScreeningResult
// in the compliance-monitor service) — mirrored here rather than imported
// since the two services don't share a package.
interface ScreeningResult {
  result: 'clear' | 'potential_match' | 'confirmed_match' | 'error';
  recommended_action: 'allow' | 'review' | 'block';
}

/**
 * Sanctions screening hook. Delegates to the compliance-monitor service when
 * COMPLIANCE_MONITOR_URL is configured; otherwise passes with a logged
 * warning (never silently).
 *
 * Previously called a nonexistent endpoint (`/api/v1/screen/address` — the
 * real route is `/api/v1/screening/address`) with no auth header and parsed
 * a `{status: 'flagged'}` shape the service has never returned. Every call
 * therefore 404'd/401'd or parsed `undefined`, and fell through to 'error' —
 * fail-closed, so no unsafe transaction went through, but every transfer was
 * being rejected whenever COMPLIANCE_MONITOR_URL was set. Fixed to match the
 * service's actual route, auth, and `ScreeningResult` response shape.
 */
export async function checkSanctions(address: string): Promise<'clear' | 'hit' | 'error'> {
  const baseUrl = process.env.COMPLIANCE_MONITOR_URL;
  if (!baseUrl) {
    // Fail-closed in production (matches the upstream OpenFireblocks policy
    // standard: an unreachable policy service denies the request).
    if (process.env.NODE_ENV === 'production') {
      logger.error({ address }, '[custody] COMPLIANCE_MONITOR_URL not set in production — sanctions screen FAILS CLOSED');
      return 'error';
    }
    logger.warn({ address }, '[custody] COMPLIANCE_MONITOR_URL not set — sanctions screen SKIPPED (dev only)');
    return 'clear';
  }
  const apiKey = process.env.COMPLIANCE_MONITOR_API_KEY;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/screening/address`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey ? { 'X-Compliance-API-Key': apiKey } : {}),
      },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.error({ address, status: res.status }, '[custody] sanctions screen returned non-2xx');
      return 'error';
    }
    const body = (await res.json()) as ScreeningResult;
    const clear = body.result === 'clear' && body.recommended_action === 'allow';
    return clear ? 'clear' : 'hit';
  } catch (err) {
    logger.error({ err, address }, '[custody] sanctions screening call failed');
    return 'error';
  }
}

export async function evaluatePolicies(input: PolicyInput): Promise<PolicyDecision> {
  const reject = (reasonCode: PolicyDecision['reasonCode']): PolicyDecision => {
    policyViolationsTotal.inc({ reason_code: reasonCode ?? 'UNKNOWN' });
    return { allowed: false, reasonCode };
  };

  // Key must exist, belong to the workspace, and be active.
  const key = keys.get(input.keyId);
  if (!key || key.workspaceId !== input.workspaceId) return reject('KEY_NOT_FOUND');
  if (key.rotationStatus === 'retired') return reject('KEY_NOT_ACTIVE');
  if (key.blockchain !== input.blockchain) return reject('CHAIN_NOT_ALLOWED');

  let requiresApproval = false;
  let approvalsRequired = 0;
  let approverRoles: string[] | undefined;

  for (const policy of policiesForWorkspace(input.workspaceId)) {
    const rules = policy.rules;

    if (rules.allowedChains && !rules.allowedChains.includes(input.blockchain)) {
      return reject('CHAIN_NOT_ALLOWED');
    }

    if (rules.whitelist) {
      const allowed = rules.whitelist.map((a) => a.toLowerCase());
      if (!allowed.includes(input.transaction.to.toLowerCase())) {
        return reject('DESTINATION_NOT_WHITELISTED');
      }
    }

    if (rules.timeWindow) {
      const now = new Date();
      const day = now.getUTCDay();
      const hour = now.getUTCHours();
      const { days, startHour, endHour } = rules.timeWindow;
      if (!days.includes(day) || hour < startHour || hour >= endHour) {
        return reject('OUTSIDE_TIME_WINDOW');
      }
    }

    if (rules.dailyLimitUsd !== undefined) {
      const used = usdSignedToday(input.workspaceId);
      if (used + input.amountUsd > rules.dailyLimitUsd) {
        return reject('DAILY_LIMIT_EXCEEDED');
      }
    }

    if (rules.approvalThreshold && input.amountUsd >= rules.approvalThreshold.amountUsd) {
      requiresApproval = true;
      approvalsRequired = Math.max(approvalsRequired, rules.approvalThreshold.approvalsRequired);
      if (rules.approvalThreshold.roles) approverRoles = rules.approvalThreshold.roles;
    }
  }

  // Sanctions screen runs last — cheapest checks first.
  const screen = await checkSanctions(input.transaction.to);
  if (screen === 'hit') return reject('SANCTIONS_HIT');
  if (screen === 'error') return reject('SANCTIONS_SCREENING_FAILED');

  return { allowed: true, requiresApproval, approvalsRequired, approverRoles };
}
