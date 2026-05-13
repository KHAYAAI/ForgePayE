import Anthropic from "@anthropic-ai/sdk";
import { registry } from "./core/registry";
import { ToolsetComposer } from "./core/toolset";
import { IterationBudget } from "./core/iteration-budget";
import { sanitizeMessages } from "./core/message-sanitizer";
import { createProvider } from "./core/provider";
import { buildSystemPrompt } from "./core/prompt-builder";
import { InMemoryStore } from "./memory/in-memory-store";
import { summarizeSession } from "./memory/summarizer";
import { loadSkills } from "./skills/loader";
// Trigger self-registration of all tools by importing the barrel
import "./tools/toolsets";
import type { AgentConfig, AgentMessage, AgentRole, SSEEvent, ToolContext, ToolsetName } from "./core/types";
import type { MemoryStore } from "./memory/store";

const DEFAULT_MAX_ITERATIONS = 90;
const LEAF_MAX_ITERATIONS    = 20;

export async function* runAgentV2(
  messages: AgentMessage[],
  config: AgentConfig,
  pendingApprovals: Map<string, boolean>,
  memoryStore: MemoryStore | undefined,
  role: AgentRole = "orchestrator"
): AsyncGenerator<SSEEvent> {
  // 1. Load skills and derive extra toolsets
  const skillDefs    = loadSkills(config.skillNames ?? []);
  const extraToolsets = skillDefs.flatMap(s => s.toolsets) as ToolsetName[];

  // 2. Compose toolsets based on mode + billingEnabled + skill toolsets
  const toolsets = ToolsetComposer.compose(config.mode, config.billingEnabled, extraToolsets);

  // 3. Get tool definitions and descriptors from registry
  const descriptors = registry.getDescriptors(toolsets);
  const toolDefs    = registry.getDefinitions(toolsets);

  // 4. Recall memory → build system prompt blocks
  const date           = new Date().toISOString().split("T")[0];
  const merchantMemory = memoryStore
    ? await memoryStore.recall(config.merchantId)
    : undefined;

  const systemBlocks = buildSystemPrompt({
    merchantName:  config.merchantName,
    merchantId:    config.merchantId,
    mode:          config.mode,
    date,
    merchantMemory: merchantMemory || undefined,
    activeSkills:  skillDefs,
  });

  // 5. Create provider
  const provider = createProvider({
    apiKey:    config.apiKey,
    model:     config.model    ?? "claude-opus-4-7",
    maxTokens: config.maxTokens ?? 4096,
    baseUrl:   config.providerBaseUrl,
  });

  // 6. Create IterationBudget
  const maxIter = config.maxIterations ?? (role === "leaf" ? LEAF_MAX_ITERATIONS : DEFAULT_MAX_ITERATIONS);
  const budget  = new IterationBudget(maxIter);

  // 7 & 8. Sanitize and convert messages to Anthropic format
  const rawMessages = sanitizeMessages(
    messages.map(m => ({ role: m.role, content: m.content }))
  );
  let conversationMessages: Anthropic.MessageParam[] = rawMessages.map(m => ({
    role:    m.role as "user" | "assistant",
    content: m.content as string,
  }));

  // Build ToolContext — leaf agents cannot spawn further sub-agents
  const toolCtx: ToolContext = {
    merchantId:   config.merchantId,
    merchantName: config.merchantName,
    apiKey:       config.apiKey,
    killBillUrl:  config.killBillUrl,
    killBillAuth: config.killBillAuth,
    memoryStore,
    spawnSubAgent: role === "orchestrator"
      ? (subtask: string) => spawnLeafAgent(subtask, config, memoryStore)
      : undefined,
  };

  // 9. Agentic loop
  while (budget.consume()) {
    // a. Emit iteration event
    yield { type: "iteration", ...budget.toEvent() };

    // b. Stream response from provider
    const stream = provider.stream({
      system:   systemBlocks,
      messages: conversationMessages,
      tools:    toolDefs,
    });

    // c. Yield text deltas as they arrive
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield { type: "text", delta: event.delta.text };
      }
    }

    // d. Retrieve completed message
    const finalMsg = await stream.finalMessage();

    // e. Collect tool_use blocks
    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    // f. If no tool calls, the model has produced its final answer → break
    if (toolUses.length === 0) break;

    // g. Append assistant message to conversation
    conversationMessages = [
      ...conversationMessages,
      { role: "assistant", content: finalMsg.content },
    ];

    // h. Partition tools: parallel (parallel:true && !requiresApproval) vs sequential
    const parallelTools   = toolUses.filter(t => {
      const d = descriptors.find(desc => desc.definition.name === t.name);
      return d?.parallel === true && d?.requiresApproval === false;
    });
    const sequentialTools = toolUses.filter(t => {
      const d = descriptors.find(desc => desc.definition.name === t.name);
      return !(d?.parallel === true && d?.requiresApproval === false);
    });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    // i–k. Execute sequential tools (with approval gate)
    for (const toolUse of sequentialTools) {
      const descriptor = descriptors.find(d => d.definition.name === toolUse.name);
      const input      = toolUse.input as Record<string, unknown>;

      yield { type: "tool_call", id: toolUse.id, name: toolUse.name, input };

      // Approval gate for destructive tools
      if (descriptor?.requiresApproval) {
        const approved = pendingApprovals.get(toolUse.id);
        if (!approved) {
          yield { type: "approval_required", id: toolUse.id, name: toolUse.name, input };
          toolResults.push({
            type:        "tool_result",
            tool_use_id: toolUse.id,
            content:     "Action requires approval. Please approve and resubmit.",
          });
          continue;
        }
      }

      // Emit delegation event when delegate_task is about to run
      if (toolUse.name === "delegate_task") {
        yield {
          type:    "delegation",
          subtask: (input.subtask as string) ?? "",
          role:    "leaf",
        };
      }

      let result: unknown;
      try {
        result = descriptor
          ? await descriptor.execute(input, toolCtx)
          : { error: "Unknown tool" };
      } catch (err) {
        result = { error: String(err) };
      }

      yield { type: "tool_result", id: toolUse.id, name: toolUse.name, result };
      toolResults.push({
        type:        "tool_result",
        tool_use_id: toolUse.id,
        content:     JSON.stringify(result),
      });
    }

    // j. Execute parallel tools concurrently
    if (parallelTools.length > 0) {
      const parallelInputs = parallelTools.map(t => ({
        toolUse:    t,
        descriptor: descriptors.find(d => d.definition.name === t.name),
        input:      t.input as Record<string, unknown>,
      }));

      // Yield tool_call events before executing
      for (const { toolUse, input } of parallelInputs) {
        yield { type: "tool_call", id: toolUse.id, name: toolUse.name, input };
      }

      const results = await Promise.all(
        parallelInputs.map(async ({ descriptor, input }) => {
          try {
            return descriptor
              ? await descriptor.execute(input, toolCtx)
              : { error: "Unknown tool" };
          } catch (err) {
            return { error: String(err) };
          }
        })
      );

      for (let i = 0; i < parallelTools.length; i++) {
        const toolUse = parallelTools[i];
        const result  = results[i];
        yield { type: "tool_result", id: toolUse.id, name: toolUse.name, result };
        toolResults.push({
          type:        "tool_result",
          tool_use_id: toolUse.id,
          content:     JSON.stringify(result),
        });
      }
    }

    // l. Append tool results as a user turn
    conversationMessages = [
      ...conversationMessages,
      { role: "user", content: toolResults },
    ];
  }

  // 10. End-of-session memory summarization
  if (config.memoryEnabled && memoryStore && messages.length >= 4) {
    try {
      const summary = await summarizeSession(
        messages,
        config.merchantId,
        config.apiKey,
        config.model ?? "claude-opus-4-7"
      );
      if (summary) {
        await memoryStore.appendSessionSummary(config.merchantId, summary);
        yield { type: "memory_update", summary };
      }
    } catch {
      // Never let summarization failure break the agent
    }
  }

  // 11. Signal completion
  yield { type: "done" };
}

export function spawnLeafAgent(
  subtask: string,
  parentConfig: AgentConfig,
  memoryStore: MemoryStore | undefined
): AsyncGenerator<SSEEvent> {
  const leafConfig: AgentConfig = {
    ...parentConfig,
    role:          "leaf",
    maxIterations: LEAF_MAX_ITERATIONS,
  };

  const leafMessages: AgentMessage[] = [{ role: "user", content: subtask }];

  return runAgentV2(leafMessages, leafConfig, new Map(), memoryStore, "leaf");
}
