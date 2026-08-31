import "./tools/toolsets";
import "./tools/evolution/platform-discovery";
import type { AgentConfig, AgentMessage, AgentRole, SSEEvent } from "./core/types";
import type { MemoryStore } from "./memory/store";
export declare function runAgentV2(messages: AgentMessage[], config: AgentConfig, pendingApprovals: Map<string, boolean>, memoryStore: MemoryStore | undefined, role?: AgentRole): AsyncGenerator<SSEEvent>;
export declare function spawnLeafAgent(subtask: string, parentConfig: AgentConfig, memoryStore: MemoryStore | undefined): AsyncGenerator<SSEEvent>;
//# sourceMappingURL=agent-v2.d.ts.map