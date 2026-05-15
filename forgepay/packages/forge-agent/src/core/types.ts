import type Anthropic from "@anthropic-ai/sdk";

export type AgentMode = "integrate" | "insight" | "act";
export type AgentRole = "orchestrator" | "leaf";

export type ToolsetName =
  | "integration" | "analytics" | "payments" | "customers"
  | "subscriptions" | "crypto" | "webhooks" | "billing"
  | "memory" | "delegation" | "treasury" | "agents" | "rwa";

// Superset of the existing SSEEvent — first 4 members are IDENTICAL to existing
export type SSEEvent =
  | { type: "text";              delta: string }
  | { type: "tool_call";         id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result";       id: string; name: string; result: unknown }
  | { type: "approval_required"; id: string; name: string; input: Record<string, unknown> }
  | { type: "iteration";         n: number; max: number }
  | { type: "memory_update";     summary?: string }
  | { type: "delegation";        subtask: string; role: "leaf" }
  | { type: "done" };

export interface ToolContext {
  merchantId:    string;
  merchantName:  string;
  apiKey:        string;
  killBillUrl?:  string;
  killBillAuth?: string;
  memoryStore?:  import("../memory/store").MemoryStore;
  spawnSubAgent?: (subtask: string) => AsyncGenerator<SSEEvent>;
}

export interface ToolDescriptor {
  definition:       Anthropic.Tool;
  execute:          (input: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
  parallel:         boolean;       // true = safe for Promise.all
  requiresApproval: boolean;
  toolsets:         ToolsetName[];
}

// Extended config — all new fields optional to preserve backward compat
export interface AgentConfig {
  // Existing required fields (unchanged)
  apiKey:           string;
  merchantId:       string;
  merchantName:     string;
  mode:             AgentMode;
  billingEnabled:   boolean;
  killBillUrl?:     string;
  killBillAuth?:    string;
  model?:           string;
  maxTokens?:       number;
  // New optional fields
  memoryEnabled?:   boolean;
  memoryDbPath?:    string;
  skillNames?:      string[];
  maxIterations?:   number;
  role?:            AgentRole;
  providerBaseUrl?: string;
}

export interface AgentMessage {
  role:    "user" | "assistant";
  content: string;
}
