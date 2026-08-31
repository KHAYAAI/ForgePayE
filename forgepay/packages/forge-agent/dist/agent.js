"use strict";
/**
 * agent.ts — backward-compatibility shim
 *
 * Public API is 100% identical to the previous single-turn agent:
 *   runAgent(messages, config, pendingApprovals) → AsyncGenerator<SSEEvent>
 *
 * Internally this delegates to the new multi-iteration runAgentV2.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.READ_ONLY_TOOLS = exports.APPROVAL_REQUIRED = void 0;
exports.runAgent = runAgent;
// Re-export constants for backward compatibility
exports.APPROVAL_REQUIRED = new Set([
    "refund_payment",
    "cancel_subscription",
    "pause_subscription",
    "resume_subscription",
    "upgrade_subscription",
]);
exports.READ_ONLY_TOOLS = new Set([
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
const agent_v2_1 = require("./agent-v2");
const file_store_1 = require("./memory/file-store");
// Use FileStore (persistent) when a path is set; fall back to InMemoryStore
function getMemoryStore(dbPath) {
    if (dbPath)
        return new file_store_1.FileStore(dbPath);
    // Use FileStore by default (persists to ~/.forgepay/agent/)
    return new file_store_1.FileStore();
}
async function* runAgent(messages, config, pendingApprovals = new Map()) {
    const memoryStore = config.memoryEnabled ? getMemoryStore(config.memoryDbPath) : undefined;
    yield* (0, agent_v2_1.runAgentV2)(messages, config, pendingApprovals, memoryStore, config.role ?? "orchestrator");
}
//# sourceMappingURL=agent.js.map