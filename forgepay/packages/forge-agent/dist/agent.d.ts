/**
 * agent.ts — backward-compatibility shim
 *
 * Public API is 100% identical to the previous single-turn agent:
 *   runAgent(messages, config, pendingApprovals) → AsyncGenerator<SSEEvent>
 *
 * Internally this delegates to the new multi-iteration runAgentV2.
 */
export type { AgentMode, AgentConfig, AgentMessage, SSEEvent } from "./core/types";
export declare const APPROVAL_REQUIRED: Set<string>;
export declare const READ_ONLY_TOOLS: Set<string>;
import type { AgentConfig, AgentMessage, SSEEvent } from "./core/types";
export declare function runAgent(messages: AgentMessage[], config: AgentConfig, pendingApprovals?: Map<string, boolean>): AsyncGenerator<SSEEvent>;
//# sourceMappingURL=agent.d.ts.map