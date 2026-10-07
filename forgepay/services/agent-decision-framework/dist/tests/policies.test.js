"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const policies_1 = require("../policies");
(0, vitest_1.describe)('policies store', () => {
    (0, vitest_1.beforeEach)(() => {
        (0, policies_1.resetPolicies)();
        (0, policies_1.clearAgentPolicies)();
    });
    (0, vitest_1.it)('seeds three default policies', () => {
        const all = (0, policies_1.listPolicies)();
        (0, vitest_1.expect)(all).toHaveLength(3);
        (0, vitest_1.expect)(all.map(p => p.id).sort()).toEqual(['p1', 'p2', 'p3']);
    });
    (0, vitest_1.it)('adds a new policy and retrieves it', () => {
        (0, policies_1.addPolicy)({
            id: 'p4', name: 'velocity cap', type: 'block_velocity_exceeded',
            params: { maxDailyVolumeUsd: 1_000_000 }, enabled: true,
        });
        (0, vitest_1.expect)((0, policies_1.getPolicy)('p4')?.name).toBe('velocity cap');
        (0, vitest_1.expect)((0, policies_1.listPolicies)()).toHaveLength(4);
    });
    (0, vitest_1.it)('updates an existing policy preserving id', () => {
        const updated = (0, policies_1.updatePolicy)('p1', { enabled: false, params: { minReputation: 20 } });
        (0, vitest_1.expect)(updated?.enabled).toBe(false);
        (0, vitest_1.expect)(updated?.params.minReputation).toBe(20);
        (0, vitest_1.expect)(updated?.id).toBe('p1');
    });
    (0, vitest_1.it)('returns null when updating an unknown policy', () => {
        (0, vitest_1.expect)((0, policies_1.updatePolicy)('nope', { enabled: false })).toBeNull();
    });
    (0, vitest_1.it)('deletes a policy and returns false on re-delete', () => {
        (0, vitest_1.expect)((0, policies_1.deletePolicy)('p2')).toBe(true);
        (0, vitest_1.expect)((0, policies_1.getPolicy)('p2')).toBeUndefined();
        (0, vitest_1.expect)((0, policies_1.deletePolicy)('p2')).toBe(false);
    });
    (0, vitest_1.it)('returns default agent policy for unknown agentId', () => {
        const p = (0, policies_1.getAgentPolicy)('new-agent');
        (0, vitest_1.expect)(p.agentId).toBe('new-agent');
        (0, vitest_1.expect)(p.requiredApprovalThresholdUsd).toBe(50_000);
        (0, vitest_1.expect)(p.blockedCounterparties).toEqual([]);
    });
    (0, vitest_1.it)('persists an agent policy override via setAgentPolicy', () => {
        const updated = (0, policies_1.setAgentPolicy)('agent-X', {
            dailyLimitUsd: 1_000_000,
            blockedCounterparties: ['bad-1'],
        });
        (0, vitest_1.expect)(updated.dailyLimitUsd).toBe(1_000_000);
        (0, vitest_1.expect)(updated.blockedCounterparties).toEqual(['bad-1']);
        (0, vitest_1.expect)((0, policies_1.getAgentPolicy)('agent-X').blockedCounterparties).toEqual(['bad-1']);
    });
});
//# sourceMappingURL=policies.test.js.map