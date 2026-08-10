/**
 * Risk Scoring Engine
 *
 * Deterministic, side-effect-free scorer combining four signals into a 0-100
 * risk total. Higher = riskier. Score bands map to a decision outcome:
 *
 *   ≥ 80  → reject
 *   ≥ 50  → require_approval
 *   <  50 → approve
 *
 * Weighted components (max contribution shown):
 *   1. Counterparty reputation (40)  — fetched from agent-identity service
 *   2. Amount factor          (25)   — amount vs agent approval threshold
 *   3. Velocity               (20)   — rolling 24h volume vs daily limit
 *   4. Policy violations      (15)   — each matched blocking policy (+15, capped)
 *
 * Hard overrides (independent of the numeric score):
 *   - counterpartyAgentId ∈ blockedCounterparties → reject
 *   - amountUsd > requiredApprovalThresholdUsd    → require_approval (at least)
 */

import {
  AgentPolicy,
  Decision,
  DecisionPolicy,
  DecisionRequest,
  RiskScore,
  VelocityWindow,
} from './types';

const AGENT_IDENTITY_API_KEY = process.env['AGENT_IDENTITY_API_KEY'] ?? '';

export interface ReputationFetcher {
  (counterpartyAgentId: string): Promise<number | null>;
}

export interface ScoreInputs {
  request:        DecisionRequest;
  agentPolicy:    AgentPolicy;
  policies:       DecisionPolicy[];
  velocity:       VelocityWindow;
  reputation?:    number | null;   // explicit override, used by tests
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeRiskScore(inputs: ScoreInputs): { score: RiskScore; matchedPolicyIds: string[]; reasons: string[] } {
  const { request, agentPolicy, policies, velocity, reputation } = inputs;
  const reasons: string[] = [];
  const matchedPolicyIds: string[] = [];

  // 1. Counterparty reputation (max 40)
  let counterpartyReputation = 0;
  if (request.counterpartyAgentId) {
    const rep = reputation ?? 50;     // unknown defaults handled by caller
    if (rep < 30) {
      counterpartyReputation = 40;
      reasons.push(`counterparty reputation ${rep} below 30`);
    } else if (rep <= 60) {
      counterpartyReputation = 20;
      reasons.push(`counterparty reputation ${rep} in 30-60 band`);
    } else {
      counterpartyReputation = 0;
    }
  }

  // 2. Amount factor (max 25) — relative to agent's required-approval threshold
  const threshold = agentPolicy.requiredApprovalThresholdUsd > 0
    ? agentPolicy.requiredApprovalThresholdUsd
    : 1;
  const amountFactor = Math.min(25, (request.amountUsd / threshold) * 25);
  if (request.amountUsd > threshold) {
    reasons.push(`amount $${request.amountUsd} exceeds approval threshold $${threshold}`);
  }

  // 3. Velocity (max 20) — projected 24h volume vs daily limit
  const projected24h = velocity.last24hUsd + request.amountUsd;
  const dailyLimit   = agentPolicy.dailyLimitUsd > 0 ? agentPolicy.dailyLimitUsd : 1;
  const velocityScore = Math.min(20, (projected24h / dailyLimit) * 20);
  if (projected24h > dailyLimit) {
    reasons.push(`projected 24h volume $${projected24h} exceeds daily limit $${dailyLimit}`);
  }

  // 4. Policy violations (max 15) — each matched policy adds 15, capped at 15
  let policyViolations = 0;
  for (const policy of policies) {
    if (!policy.enabled) continue;
    if (policyMatches(policy, request, agentPolicy, velocity, reputation ?? undefined)) {
      matchedPolicyIds.push(policy.id);
      policyViolations = 15;
      reasons.push(`policy ${policy.id} (${policy.name}) matched`);
    }
  }

  const total = clamp(
    counterpartyReputation + amountFactor + velocityScore + policyViolations,
    0,
    100,
  );

  const score: RiskScore = {
    total,
    components: {
      counterpartyReputation,
      amountFactor,
      velocity:         velocityScore,
      policyViolations,
    },
    ...(reputation !== undefined && reputation !== null ? { reputation } : {}),
  };

  return { score, matchedPolicyIds, reasons };
}

export function decide(inputs: ScoreInputs): Decision {
  const { request, agentPolicy } = inputs;
  const { score, matchedPolicyIds, reasons } = computeRiskScore(inputs);

  // ── Hard overrides ────────────────────────────────────────────────────────
  let outcome: Decision['decision'] = 'approve';

  // Blocklist override always wins
  if (request.counterpartyAgentId && agentPolicy.blockedCounterparties.includes(request.counterpartyAgentId)) {
    reasons.push(`counterparty ${request.counterpartyAgentId} is on agent's blocklist`);
    outcome = 'reject';
  } else {
    // Score band
    if (score.total >= 80) {
      outcome = 'reject';
    } else if (score.total >= 50) {
      outcome = 'require_approval';
    } else {
      outcome = 'approve';
    }

    // Approval threshold override: never auto-approve above it
    if (outcome === 'approve' && request.amountUsd > agentPolicy.requiredApprovalThresholdUsd) {
      outcome = 'require_approval';
      reasons.push(`amount above approval threshold forces manual review`);
    }
  }

  return {
    decision:           outcome,
    score:              score.total,
    reasons,
    policy_violations:  matchedPolicyIds,
    riskScore:          score,
    timestamp:          new Date().toISOString(),
    agentId:            request.agentId,
    actionType:         request.actionType,
    amountUsd:          request.amountUsd,
    asset:              request.asset,
    ...(request.counterpartyAgentId ? { counterpartyAgentId: request.counterpartyAgentId } : {}),
  };
}

// ── Reputation fetch helper ───────────────────────────────────────────────────

/**
 * Fetch counterparty reputation from the agent-identity service. Defaults to
 * 50 (neutral) if the service is unreachable so a transient outage does not
 * cause every decision to be rejected.
 */
export async function fetchReputation(
  baseUrl: string,
  counterpartyAgentId: string,
): Promise<number> {
  try {
    // `/reputation` returns the raw event list (`{ data: events[], total }`),
    // not a summary — this used to read `reputation`/`score` off that body,
    // find neither, and silently return the neutral 50 for every agent. The
    // summary lives on the agent record.
    const res = await fetch(`${baseUrl}/v1/agents/${encodeURIComponent(counterpartyAgentId)}`, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        'Accept': 'application/json',
        // agent-identity requires a key on this route; sending none 401s in
        // production, which also silently degraded to 50.
        ...(AGENT_IDENTITY_API_KEY ? { 'X-Api-Key': AGENT_IDENTITY_API_KEY } : {}),
      },
    });
    if (!res.ok) return 50;

    const json = await res.json() as { data?: { reputationScore?: number } };
    const raw = json.data?.reputationScore;
    if (typeof raw !== 'number') return 50;

    // agent-identity scores 0–1000 (default 500); this scorer works in 0–100,
    // so a raw 500 would previously have clamped to 100 rather than 50.
    return clamp(Math.round(raw / 10), 0, 100);
  } catch {
    return 50;
  }
}

// ── Internals ─────────────────────────────────────────────────────────────────

function policyMatches(
  policy:       DecisionPolicy,
  request:      DecisionRequest,
  agentPolicy:  AgentPolicy,
  velocity:     VelocityWindow,
  reputation:   number | undefined,
): boolean {
  switch (policy.type) {
    case 'block_low_reputation': {
      if (!request.counterpartyAgentId) return false;
      if (reputation === undefined)     return false;
      const min = policy.params.minReputation ?? 0;
      return reputation < min;
    }
    case 'block_high_amount': {
      const max = policy.params.maxAmountUsd ?? Infinity;
      return request.amountUsd > max;
    }
    case 'require_approval_above': {
      const t = policy.params.thresholdUsd ?? Infinity;
      return request.amountUsd > t;
    }
    case 'block_blocked_counterparty': {
      if (!request.counterpartyAgentId) return false;
      return agentPolicy.blockedCounterparties.includes(request.counterpartyAgentId);
    }
    case 'block_velocity_exceeded': {
      const max = policy.params.maxDailyVolumeUsd ?? Infinity;
      return (velocity.last24hUsd + request.amountUsd) > max;
    }
    case 'block_unknown_counterparty': {
      if (!request.counterpartyAgentId) return true;
      // Unknown if reputation lookup returned no record. We treat undefined as unknown.
      return reputation === undefined;
    }
    default:
      return false;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
