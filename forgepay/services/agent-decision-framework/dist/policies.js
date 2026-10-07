"use strict";
/**
 * Decision Policy Store
 *
 * Holds two collections:
 *   - Global DecisionPolicy[]   — rule-based gates evaluated for every request
 *   - Per-agent AgentPolicy     — overrides (risk tolerance, daily limit,
 *                                 counterparty blocklist, approval threshold)
 *
 * In production both stores would live in Postgres with an audit trail. Here
 * we use in-memory Maps seeded with sensible defaults.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_AGENT_POLICY = void 0;
exports.setPolicySink = setPolicySink;
exports.hydratePolicies = hydratePolicies;
exports.listDefaultPolicies = listDefaultPolicies;
exports.listPolicies = listPolicies;
exports.getPolicy = getPolicy;
exports.addPolicy = addPolicy;
exports.updatePolicy = updatePolicy;
exports.deletePolicy = deletePolicy;
exports.resetPolicies = resetPolicies;
exports.getAgentPolicy = getAgentPolicy;
exports.setAgentPolicy = setAgentPolicy;
exports.clearAgentPolicies = clearAgentPolicies;
// ── Global policies ───────────────────────────────────────────────────────────
const policies = new Map();
let sink = null;
function setPolicySink(s) { sink = s; }
/** Replace in-memory policies with what was stored (even if empty: an operator may have deleted them all). */
function hydratePolicies(globals, agents) {
    policies.clear();
    agentPolicies.clear();
    for (const g of globals)
        policies.set(g.id, g);
    for (const a of agents)
        agentPolicies.set(a.agentId, a);
}
function listDefaultPolicies() {
    return DEFAULT_POLICIES.map((p) => ({ ...p, params: { ...p.params } }));
}
const DEFAULT_POLICIES = [
    { id: 'p1', name: 'Block sub-30 reputation', type: 'block_low_reputation', params: { minReputation: 30 }, enabled: true },
    { id: 'p2', name: 'Approval over $50k', type: 'require_approval_above', params: { thresholdUsd: 50_000 }, enabled: true },
    { id: 'p3', name: 'Block over $500k', type: 'block_high_amount', params: { maxAmountUsd: 500_000 }, enabled: true },
];
function seed() {
    if (policies.size === 0) {
        for (const p of DEFAULT_POLICIES)
            policies.set(p.id, { ...p, params: { ...p.params } });
    }
}
seed();
function listPolicies() {
    return Array.from(policies.values());
}
function getPolicy(id) {
    return policies.get(id);
}
function addPolicy(policy) {
    policies.set(policy.id, policy);
    sink?.upsertPolicy(policy);
    return policy;
}
function updatePolicy(id, patch) {
    const existing = policies.get(id);
    if (!existing)
        return null;
    const merged = {
        ...existing,
        ...patch,
        id,
        params: { ...existing.params, ...(patch.params ?? {}) },
    };
    policies.set(id, merged);
    sink?.upsertPolicy(merged);
    return merged;
}
function deletePolicy(id) {
    const removed = policies.delete(id);
    if (removed)
        sink?.removePolicy(id);
    return removed;
}
function resetPolicies() {
    policies.clear();
    seed();
}
// ── Per-agent policies ────────────────────────────────────────────────────────
const agentPolicies = new Map();
exports.DEFAULT_AGENT_POLICY = {
    riskTolerance: 50,
    dailyLimitUsd: 250_000,
    blockedCounterparties: [],
    requiredApprovalThresholdUsd: 50_000,
};
function getAgentPolicy(agentId) {
    const existing = agentPolicies.get(agentId);
    if (existing)
        return existing;
    return { agentId, ...exports.DEFAULT_AGENT_POLICY };
}
function setAgentPolicy(agentId, patch) {
    const current = getAgentPolicy(agentId);
    const merged = {
        ...current,
        ...patch,
        agentId,
        blockedCounterparties: patch.blockedCounterparties ?? current.blockedCounterparties,
    };
    agentPolicies.set(agentId, merged);
    sink?.upsertAgentPolicy(merged);
    return merged;
}
function clearAgentPolicies() {
    agentPolicies.clear();
}
//# sourceMappingURL=policies.js.map