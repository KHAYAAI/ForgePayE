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
import { AgentPolicy, Decision, DecisionPolicy, DecisionRequest, RiskScore, VelocityWindow } from './types';
export interface ReputationFetcher {
    (counterpartyAgentId: string): Promise<number | null>;
}
export interface ScoreInputs {
    request: DecisionRequest;
    agentPolicy: AgentPolicy;
    policies: DecisionPolicy[];
    velocity: VelocityWindow;
    reputation?: number | null;
}
export declare function computeRiskScore(inputs: ScoreInputs): {
    score: RiskScore;
    matchedPolicyIds: string[];
    reasons: string[];
};
export declare function decide(inputs: ScoreInputs): Decision;
/**
 * Fetch counterparty reputation from the agent-identity service. Defaults to
 * 50 (neutral) if the service is unreachable so a transient outage does not
 * cause every decision to be rejected.
 */
export declare function fetchReputation(baseUrl: string, counterpartyAgentId: string): Promise<number>;
//# sourceMappingURL=risk-scorer.d.ts.map