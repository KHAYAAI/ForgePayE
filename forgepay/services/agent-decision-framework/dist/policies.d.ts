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
import { AgentPolicy, DecisionPolicy } from './types';
/** Where changes are made durable. Set by persistence.ts when a database is configured. */
export interface PolicySink {
    upsertPolicy(p: DecisionPolicy): void;
    removePolicy(id: string): void;
    upsertAgentPolicy(p: AgentPolicy): void;
}
export declare function setPolicySink(s: PolicySink | null): void;
/** Replace in-memory policies with what was stored (even if empty: an operator may have deleted them all). */
export declare function hydratePolicies(globals: DecisionPolicy[], agents: AgentPolicy[]): void;
export declare function listDefaultPolicies(): DecisionPolicy[];
export declare function listPolicies(): DecisionPolicy[];
export declare function getPolicy(id: string): DecisionPolicy | undefined;
export declare function addPolicy(policy: DecisionPolicy): DecisionPolicy;
export declare function updatePolicy(id: string, patch: Partial<DecisionPolicy>): DecisionPolicy | null;
export declare function deletePolicy(id: string): boolean;
export declare function resetPolicies(): void;
export declare const DEFAULT_AGENT_POLICY: Omit<AgentPolicy, 'agentId'>;
export declare function getAgentPolicy(agentId: string): AgentPolicy;
export declare function setAgentPolicy(agentId: string, patch: Partial<Omit<AgentPolicy, 'agentId'>>): AgentPolicy;
export declare function clearAgentPolicies(): void;
//# sourceMappingURL=policies.d.ts.map