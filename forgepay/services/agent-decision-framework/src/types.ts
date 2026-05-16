/**
 * ForgePay Agent Decision Framework — shared types
 *
 * Domain model for autonomous decision evaluation, risk scoring, policy
 * gating, and per-agent overrides. All monetary values in USD.
 */

export type ActionType =
  | 'payment'
  | 'transfer'
  | 'swap'
  | 'subscription'
  | 'refund'
  | 'payout'
  | 'custom';

export type DecisionOutcome = 'approve' | 'reject' | 'require_approval';

export type PolicyType =
  | 'block_low_reputation'
  | 'block_high_amount'
  | 'require_approval_above'
  | 'block_blocked_counterparty'
  | 'block_velocity_exceeded'
  | 'block_unknown_counterparty';

export interface DecisionRequest {
  agentId:              string;
  actionType:           ActionType;
  counterpartyAgentId?: string;
  amountUsd:            number;
  asset:                string;
  metadata?:            Record<string, unknown>;
}

export interface RiskScore {
  total:                number;          // 0-100, higher = riskier
  components: {
    counterpartyReputation: number;
    amountFactor:           number;
    velocity:               number;
    policyViolations:       number;
  };
  reputation?:          number;          // Raw fetched reputation 0-100
}

export interface Decision {
  decision:             DecisionOutcome;
  score:                number;          // total risk score
  reasons:              string[];
  policy_violations:    string[];        // policy ids that triggered
  riskScore:            RiskScore;
  timestamp:            string;
  agentId:              string;
  actionType:           ActionType;
  amountUsd:            number;
  asset:                string;
  counterpartyAgentId?: string;
}

export interface DecisionPolicy {
  id:       string;
  name:     string;
  type:     PolicyType;
  params:   {
    minReputation?:      number;
    maxAmountUsd?:       number;
    thresholdUsd?:       number;
    maxDailyVolumeUsd?:  number;
  };
  enabled:  boolean;
}

export interface AgentPolicy {
  agentId:                       string;
  riskTolerance:                 number;  // 0-100; higher = more permissive
  dailyLimitUsd:                 number;
  blockedCounterparties:         string[];
  requiredApprovalThresholdUsd:  number;
}

export interface VelocityEntry {
  timestamp:  number;   // epoch ms
  amountUsd:  number;
}

export interface VelocityWindow {
  agentId:        string;
  last1hUsd:      number;
  last24hUsd:     number;
  last7dUsd:      number;
  txCount1h:      number;
  txCount24h:     number;
  txCount7d:      number;
  computedAt:     string;
}
