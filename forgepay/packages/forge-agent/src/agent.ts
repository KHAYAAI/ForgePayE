/**
 * agent.ts — backward-compatibility shim
 *
 * Public API is 100% identical to the previous single-turn agent:
 *   runAgent(messages, config, pendingApprovals) → AsyncGenerator<SSEEvent>
 *
 * Internally this delegates to the new multi-iteration runAgentV2.
 */

// Re-export types from the new canonical location so existing importers keep working
export type { AgentMode, AgentConfig, AgentMessage, SSEEvent } from "./core/types";

// Re-export constants for backward compatibility
export const APPROVAL_REQUIRED = new Set([
  "refund_payment",
  "cancel_subscription",
  "pause_subscription",
  "resume_subscription",
  "upgrade_subscription",
]);

export const READ_ONLY_TOOLS = new Set([
  "get_analytics",
  "list_payments",
  "list_customers",
  "get_customer",
  "list_subscriptions",
  "list_plans",
  "get_webhook_status",
  "list_stablecoin_payments",
  "list_crypto_payments",
]);

import { runAgentV2 } from "./agent-v2";
import { InMemoryStore } from "./memory/in-memory-store";
import type { AgentConfig, AgentMessage, SSEEvent } from "./core/types";

// Singleton in-memory store — one instance for the lifetime of this process
let _memoryStore: InMemoryStore | undefined;
function getMemoryStore(): InMemoryStore {
  if (!_memoryStore) _memoryStore = new InMemoryStore();
  return _memoryStore;
}

export async function* runAgent(
  messages: AgentMessage[],
  config: AgentConfig,
  pendingApprovals: Map<string, boolean> = new Map()
): AsyncGenerator<SSEEvent> {
  const memoryStore = config.memoryEnabled ? getMemoryStore() : undefined;
  yield* runAgentV2(
    messages,
    config,
    pendingApprovals,
    memoryStore,
    config.role ?? "orchestrator"
  );
}
