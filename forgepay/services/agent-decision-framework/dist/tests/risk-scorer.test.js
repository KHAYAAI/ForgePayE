"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const risk_scorer_1 = require("../risk-scorer");
function makeAgentPolicy(overrides = {}) {
    return {
        agentId: 'agent-A',
        riskTolerance: 50,
        dailyLimitUsd: 250_000,
        blockedCounterparties: [],
        requiredApprovalThresholdUsd: 50_000,
        ...overrides,
    };
}
function makeRequest(overrides = {}) {
    return {
        agentId: 'agent-A',
        actionType: 'payment',
        amountUsd: 1_000,
        asset: 'USDC',
        ...overrides,
    };
}
function makeVelocity(overrides = {}) {
    return {
        agentId: 'agent-A',
        last1hUsd: 0,
        last24hUsd: 0,
        last7dUsd: 0,
        txCount1h: 0,
        txCount24h: 0,
        txCount7d: 0,
        computedAt: new Date().toISOString(),
        ...overrides,
    };
}
(0, vitest_1.describe)('risk-scorer', () => {
    (0, vitest_1.it)('returns approve with low score for a small benign request', () => {
        const decision = (0, risk_scorer_1.decide)({
            request: makeRequest({ amountUsd: 100 }),
            agentPolicy: makeAgentPolicy(),
            policies: [],
            velocity: makeVelocity(),
        });
        (0, vitest_1.expect)(decision.decision).toBe('approve');
        (0, vitest_1.expect)(decision.score).toBeLessThan(50);
    });
    (0, vitest_1.it)('adds 40 reputation points when counterparty reputation is below 30', () => {
        const { score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100 }),
            agentPolicy: makeAgentPolicy(),
            policies: [],
            velocity: makeVelocity(),
            reputation: 10,
        });
        (0, vitest_1.expect)(score.components.counterpartyReputation).toBe(40);
    });
    (0, vitest_1.it)('adds 20 reputation points for mid-band reputation (30-60)', () => {
        const { score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100 }),
            agentPolicy: makeAgentPolicy(),
            policies: [],
            velocity: makeVelocity(),
            reputation: 45,
        });
        (0, vitest_1.expect)(score.components.counterpartyReputation).toBe(20);
    });
    (0, vitest_1.it)('adds 0 reputation points when reputation is above 60', () => {
        const { score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100 }),
            agentPolicy: makeAgentPolicy(),
            policies: [],
            velocity: makeVelocity(),
            reputation: 90,
        });
        (0, vitest_1.expect)(score.components.counterpartyReputation).toBe(0);
    });
    (0, vitest_1.it)('caps amount factor at 25 even for huge amounts', () => {
        const { score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ amountUsd: 10_000_000 }),
            agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000 }),
            policies: [],
            velocity: makeVelocity(),
        });
        (0, vitest_1.expect)(score.components.amountFactor).toBe(25);
    });
    (0, vitest_1.it)('caps velocity at 20 when projected 24h volume exceeds daily limit', () => {
        const { score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ amountUsd: 100_000 }),
            agentPolicy: makeAgentPolicy({ dailyLimitUsd: 100_000 }),
            policies: [],
            velocity: makeVelocity({ last24hUsd: 500_000 }),
        });
        (0, vitest_1.expect)(score.components.velocity).toBe(20);
    });
    (0, vitest_1.it)('require_approval when amount exceeds approval threshold even with clean signals', () => {
        const decision = (0, risk_scorer_1.decide)({
            request: makeRequest({ amountUsd: 60_000 }),
            agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 10_000_000 }),
            policies: [],
            velocity: makeVelocity(),
        });
        (0, vitest_1.expect)(decision.decision).toBe('require_approval');
    });
    (0, vitest_1.it)('rejects when final score >= 80', () => {
        // reputation 40 + amount 25 + velocity 20 = 85
        const decision = (0, risk_scorer_1.decide)({
            request: makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 200_000 }),
            agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 100_000 }),
            policies: [],
            velocity: makeVelocity({ last24hUsd: 200_000 }),
            reputation: 5,
        });
        (0, vitest_1.expect)(decision.score).toBeGreaterThanOrEqual(80);
        (0, vitest_1.expect)(decision.decision).toBe('reject');
    });
    (0, vitest_1.it)('require_approval band activates at 50 ≤ score < 80', () => {
        // amount 25 + reputation 20 = 45 → bump with a tiny velocity → 50+
        const decision = (0, risk_scorer_1.decide)({
            request: makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 100_000 }),
            agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 1_000_000 }),
            policies: [],
            velocity: makeVelocity({ last24hUsd: 250_000 }),
            reputation: 45,
        });
        (0, vitest_1.expect)(decision.score).toBeGreaterThanOrEqual(50);
        (0, vitest_1.expect)(decision.score).toBeLessThan(80);
        (0, vitest_1.expect)(decision.decision).toBe('require_approval');
    });
    (0, vitest_1.it)('automatic reject when counterparty is in agent blocklist regardless of score', () => {
        const decision = (0, risk_scorer_1.decide)({
            request: makeRequest({ counterpartyAgentId: 'evil-1', amountUsd: 100 }),
            agentPolicy: makeAgentPolicy({ blockedCounterparties: ['evil-1'] }),
            policies: [],
            velocity: makeVelocity(),
            reputation: 100,
        });
        (0, vitest_1.expect)(decision.decision).toBe('reject');
        (0, vitest_1.expect)(decision.reasons.some(r => r.includes('blocklist'))).toBe(true);
    });
    (0, vitest_1.it)('matches block_high_amount policy and reports violation', () => {
        const policy = {
            id: 'pHA', name: 'block over 1000', type: 'block_high_amount',
            params: { maxAmountUsd: 1_000 }, enabled: true,
        };
        const { matchedPolicyIds, score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ amountUsd: 5_000 }),
            agentPolicy: makeAgentPolicy(),
            policies: [policy],
            velocity: makeVelocity(),
        });
        (0, vitest_1.expect)(matchedPolicyIds).toContain('pHA');
        (0, vitest_1.expect)(score.components.policyViolations).toBe(15);
    });
    (0, vitest_1.it)('policy violations are capped at 15 even with multiple matches', () => {
        const policies = [
            { id: 'a', name: 'a', type: 'block_high_amount', params: { maxAmountUsd: 100 }, enabled: true },
            { id: 'b', name: 'b', type: 'require_approval_above', params: { thresholdUsd: 100 }, enabled: true },
        ];
        const { score, matchedPolicyIds } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ amountUsd: 5_000 }),
            agentPolicy: makeAgentPolicy(),
            policies,
            velocity: makeVelocity(),
        });
        (0, vitest_1.expect)(matchedPolicyIds.length).toBe(2);
        (0, vitest_1.expect)(score.components.policyViolations).toBe(15);
    });
    (0, vitest_1.it)('skips disabled policies', () => {
        const policies = [
            { id: 'off', name: 'off', type: 'block_high_amount', params: { maxAmountUsd: 100 }, enabled: false },
        ];
        const { matchedPolicyIds, score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ amountUsd: 5_000 }),
            agentPolicy: makeAgentPolicy(),
            policies,
            velocity: makeVelocity(),
        });
        (0, vitest_1.expect)(matchedPolicyIds).toHaveLength(0);
        (0, vitest_1.expect)(score.components.policyViolations).toBe(0);
    });
    (0, vitest_1.it)('total score is clamped to 100', () => {
        const policies = [
            { id: 'x', name: 'x', type: 'block_high_amount', params: { maxAmountUsd: 100 }, enabled: true },
        ];
        const { score } = (0, risk_scorer_1.computeRiskScore)({
            request: makeRequest({ counterpartyAgentId: 'cp-1', amountUsd: 10_000_000 }),
            agentPolicy: makeAgentPolicy({ requiredApprovalThresholdUsd: 50_000, dailyLimitUsd: 1_000 }),
            policies,
            velocity: makeVelocity({ last24hUsd: 10_000_000 }),
            reputation: 0,
        });
        (0, vitest_1.expect)(score.total).toBeLessThanOrEqual(100);
    });
});
//# sourceMappingURL=risk-scorer.test.js.map