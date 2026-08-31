"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAgentV2 = runAgentV2;
exports.spawnLeafAgent = spawnLeafAgent;
const registry_1 = require("./core/registry");
const toolset_1 = require("./core/toolset");
const iteration_budget_1 = require("./core/iteration-budget");
const message_sanitizer_1 = require("./core/message-sanitizer");
const provider_1 = require("./core/provider");
const prompt_builder_1 = require("./core/prompt-builder");
const summarizer_1 = require("./memory/summarizer");
const merchant_profile_1 = require("./memory/merchant-profile");
const session_learner_1 = require("./evolution/session-learner");
const loader_1 = require("./skills/loader");
// Trigger self-registration of all tools by importing the barrel
require("./tools/toolsets");
require("./tools/evolution/platform-discovery");
const DEFAULT_MAX_ITERATIONS = 90;
const LEAF_MAX_ITERATIONS = 20;
async function* runAgentV2(messages, config, pendingApprovals, memoryStore, role = "orchestrator") {
    // 1. Load skills and derive extra toolsets
    // Load skills asynchronously (includes dynamically learned skills)
    const skillIds = [...(config.skillNames ?? []), "all_learned"];
    const skillDefs = await (0, loader_1.loadSkillsWithDynamic)(skillIds);
    const extraToolsets = skillDefs.flatMap(s => s.toolsets);
    // 2. Compose toolsets based on mode + billingEnabled + skill toolsets
    const toolsets = toolset_1.ToolsetComposer.compose(config.mode, config.billingEnabled, extraToolsets);
    // 3. Get tool definitions and descriptors from registry
    const descriptors = registry_1.registry.getDescriptors(toolsets);
    const toolDefs = registry_1.registry.getDefinitions(toolsets);
    // 4. Recall memory → build system prompt blocks
    const date = new Date().toISOString().split("T")[0];
    const merchantMemory = memoryStore
        ? await memoryStore.recall(config.merchantId)
        : undefined;
    const merchantProfile = memoryStore
        ? await (0, merchant_profile_1.getMerchantProfile)(config.merchantId, config.merchantName, memoryStore)
        : undefined;
    const profileText = merchantProfile ? (0, merchant_profile_1.formatProfileForPrompt)(merchantProfile) : undefined;
    const systemBlocks = (0, prompt_builder_1.buildSystemPrompt)({
        merchantName: config.merchantName,
        merchantId: config.merchantId,
        mode: config.mode,
        date,
        merchantMemory: [merchantMemory, profileText].filter(Boolean).join("\n\n") || undefined,
        activeSkills: skillDefs,
    });
    // 5. Create provider
    const provider = (0, provider_1.createProvider)({
        apiKey: config.apiKey,
        model: config.model ?? "claude-opus-4-7",
        maxTokens: config.maxTokens ?? 4096,
        baseUrl: config.providerBaseUrl,
    });
    // 6. Create IterationBudget
    const maxIter = config.maxIterations ?? (role === "leaf" ? LEAF_MAX_ITERATIONS : DEFAULT_MAX_ITERATIONS);
    const budget = new iteration_budget_1.IterationBudget(maxIter);
    // 7 & 8. Sanitize and convert messages to Anthropic format
    const rawMessages = (0, message_sanitizer_1.sanitizeMessages)(messages.map(m => ({ role: m.role, content: m.content })));
    let conversationMessages = rawMessages.map(m => ({
        role: m.role,
        content: m.content,
    }));
    // Build ToolContext — leaf agents cannot spawn further sub-agents
    const toolCtx = {
        merchantId: config.merchantId,
        merchantName: config.merchantName,
        apiKey: config.apiKey,
        killBillUrl: config.killBillUrl,
        killBillAuth: config.killBillAuth,
        memoryStore,
        spawnSubAgent: role === "orchestrator"
            ? (subtask) => spawnLeafAgent(subtask, config, memoryStore)
            : undefined,
    };
    // 9. Agentic loop
    while (budget.consume()) {
        // a. Emit iteration event
        yield { type: "iteration", ...budget.toEvent() };
        // b. Stream response from provider
        const stream = provider.stream({
            system: systemBlocks,
            messages: conversationMessages,
            tools: toolDefs,
        });
        // c. Yield text deltas as they arrive
        for await (const event of stream) {
            if (event.type === "content_block_delta" &&
                event.delta.type === "text_delta") {
                yield { type: "text", delta: event.delta.text };
            }
        }
        // d. Retrieve completed message
        const finalMsg = await stream.finalMessage();
        // e. Collect tool_use blocks
        const toolUses = finalMsg.content.filter((b) => b.type === "tool_use");
        // f. If no tool calls, the model has produced its final answer → break
        if (toolUses.length === 0)
            break;
        // g. Append assistant message to conversation
        conversationMessages = [
            ...conversationMessages,
            { role: "assistant", content: finalMsg.content },
        ];
        // h. Partition tools: parallel (parallel:true && !requiresApproval) vs sequential
        const parallelTools = toolUses.filter(t => {
            const d = descriptors.find(desc => desc.definition.name === t.name);
            return d?.parallel === true && d?.requiresApproval === false;
        });
        const sequentialTools = toolUses.filter(t => {
            const d = descriptors.find(desc => desc.definition.name === t.name);
            return !(d?.parallel === true && d?.requiresApproval === false);
        });
        const toolResults = [];
        // i–k. Execute sequential tools (with approval gate)
        for (const toolUse of sequentialTools) {
            const descriptor = descriptors.find(d => d.definition.name === toolUse.name);
            const input = toolUse.input;
            yield { type: "tool_call", id: toolUse.id, name: toolUse.name, input };
            // Approval gate for destructive tools
            if (descriptor?.requiresApproval) {
                const approved = pendingApprovals.get(toolUse.id);
                if (!approved) {
                    yield { type: "approval_required", id: toolUse.id, name: toolUse.name, input };
                    toolResults.push({
                        type: "tool_result",
                        tool_use_id: toolUse.id,
                        content: "Action requires approval. Please approve and resubmit.",
                    });
                    continue;
                }
            }
            // Emit delegation event when delegate_task is about to run
            if (toolUse.name === "delegate_task") {
                yield {
                    type: "delegation",
                    subtask: input.subtask ?? "",
                    role: "leaf",
                };
            }
            let result;
            try {
                result = descriptor
                    ? await descriptor.execute(input, toolCtx)
                    : { error: "Unknown tool" };
            }
            catch (err) {
                result = { error: String(err) };
            }
            yield { type: "tool_result", id: toolUse.id, name: toolUse.name, result };
            toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(result),
            });
        }
        // j. Execute parallel tools concurrently
        if (parallelTools.length > 0) {
            const parallelInputs = parallelTools.map(t => ({
                toolUse: t,
                descriptor: descriptors.find(d => d.definition.name === t.name),
                input: t.input,
            }));
            // Yield tool_call events before executing
            for (const { toolUse, input } of parallelInputs) {
                yield { type: "tool_call", id: toolUse.id, name: toolUse.name, input };
            }
            const results = await Promise.all(parallelInputs.map(async ({ descriptor, input }) => {
                try {
                    return descriptor
                        ? await descriptor.execute(input, toolCtx)
                        : { error: "Unknown tool" };
                }
                catch (err) {
                    return { error: String(err) };
                }
            }));
            for (let i = 0; i < parallelTools.length; i++) {
                const toolUse = parallelTools[i];
                const result = results[i];
                yield { type: "tool_result", id: toolUse.id, name: toolUse.name, result };
                toolResults.push({
                    type: "tool_result",
                    tool_use_id: toolUse.id,
                    content: JSON.stringify(result),
                });
            }
        }
        // l. Append tool results as a user turn
        conversationMessages = [
            ...conversationMessages,
            { role: "user", content: toolResults },
        ];
    }
    // 10. End-of-session learning (summarization + merchant profile update + skill suggestion)
    if (config.memoryEnabled && memoryStore && messages.length >= 4) {
        try {
            // Session summarization
            const summary = await (0, summarizer_1.summarizeSession)(messages, config.merchantId, config.apiKey, config.model ?? "claude-opus-4-7");
            if (summary) {
                await memoryStore.appendSessionSummary(config.merchantId, summary);
                yield { type: "memory_update", summary };
            }
            // Deep session learning — profile updates + skill suggestions
            const learning = await (0, session_learner_1.learnFromSession)(messages, config.merchantId, config.merchantName, config.apiKey, config.model ?? "claude-opus-4-7", memoryStore);
            if (learning.suggestedSkill) {
                const { getDynamicSkillStore } = await Promise.resolve().then(() => __importStar(require("./skills/dynamic-store")));
                await getDynamicSkillStore().createSkill(learning.suggestedSkill);
            }
        }
        catch {
            // Don't let learning failure break the agent
        }
    }
    // 11. Signal completion
    yield { type: "done" };
}
function spawnLeafAgent(subtask, parentConfig, memoryStore) {
    const leafConfig = {
        ...parentConfig,
        role: "leaf",
        maxIterations: LEAF_MAX_ITERATIONS,
    };
    const leafMessages = [{ role: "user", content: subtask }];
    return runAgentV2(leafMessages, leafConfig, new Map(), memoryStore, "leaf");
}
//# sourceMappingURL=agent-v2.js.map