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

/**
 * Sanctions screening hook. Delegates to the compliance-monitor service when
 * COMPLIANCE_MONITOR_URL is configured; otherwise passes with a logged
 * warning (never silently).
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
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/screen/address`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'error';
    const body = (await res.json()) as { status?: string };
    return body.status === 'flagged' ? 'hit' : 'clear';
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
