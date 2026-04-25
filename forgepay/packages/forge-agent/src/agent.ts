import Anthropic from "@anthropic-ai/sdk";
import { coreTools, APPROVAL_REQUIRED, READ_ONLY_TOOLS } from "./tools/index.js";
import {
  billingTools,
  BILLING_APPROVAL_REQUIRED,
  executeBillingTool,
} from "./tools/billing.js";

export type AgentMode = "integrate" | "insight" | "act";

export interface AgentConfig {
  apiKey:              string;
  merchantId:          string;
  merchantName:        string;
  mode:                AgentMode;
  billingEnabled:      boolean;
  killBillUrl?:        string;
  killBillAuth?:       string;
  model?:              string;
  maxTokens?:          number;
}

export type SSEEvent =
  | { type: "text";             delta: string }
  | { type: "tool_call";        id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result";      id: string; name: string; result: unknown }
  | { type: "approval_required"; id: string; name: string; input: Record<string, unknown> }
  | { type: "done" };

export interface AgentMessage {
  role:    "user" | "assistant";
  content: string;
}

const SYSTEM_PROMPT = (
  merchantName: string,
  merchantId: string,
  mode: AgentMode,
  date: string
) => `You are Forge Agent, ForgePay's AI billing assistant. You help merchants:
- Integrate ForgePay into their codebase (Integrate mode)
- Analyze revenue, churn, and payment metrics (Insight mode)
- Take actions like refunds, subscription changes (Act mode)

Current merchant: ${merchantName} (${merchantId})
Current date: ${date}
Mode: ${mode}

ForgePay pricing: Cards 2% + $0.20 | Stablecoins/Crypto 1.4% + gas | Platform $5/month

Rules:
- Always show amounts in USD with 2 decimal places
- For destructive actions (refunds, cancellations), always confirm with the merchant first
- In Integrate mode, provide copy-pasteable code using @forgepay/sdk
- In Insight mode, always cite the date range of data you're analyzing
- Never reveal the merchant's API key or secret
- In Integrate mode, only use get_integration_code — do not call data tools
- In Insight mode, only use read-only tools — do not take mutating actions`;

function buildToolList(
  mode: AgentMode,
  billingEnabled: boolean
): Anthropic.Tool[] {
  let tools = [...coreTools];

  if (billingEnabled) {
    tools = [...tools, ...billingTools];
  }

  if (mode === "integrate") {
    return tools.filter((t) => t.name === "get_integration_code");
  }

  if (mode === "insight") {
    return tools.filter(
      (t) =>
        READ_ONLY_TOOLS.has(t.name) ||
        t.name === "get_invoice" ||
        t.name === "list_account_invoices" ||
        t.name === "get_account_overdue"
    );
  }

  return tools;
}

function isApprovalRequired(toolName: string): boolean {
  return APPROVAL_REQUIRED.has(toolName) || BILLING_APPROVAL_REQUIRED.has(toolName);
}

// Stub SDK executor — in production this calls @forgepay/sdk with merchant's API key
async function executeCoreToolStub(
  toolName: string,
  _toolInput: Record<string, unknown>
): Promise<unknown> {
  return { stub: true, tool: toolName, message: "SDK integration pending" };
}

export async function* runAgent(
  messages: AgentMessage[],
  config: AgentConfig,
  // Map of tool_id → approval decision (true = approved)
  pendingApprovals: Map<string, boolean> = new Map()
): AsyncGenerator<SSEEvent> {
  const client = new Anthropic({ apiKey: config.apiKey });
  const tools = buildToolList(config.mode, config.billingEnabled);
  const date = new Date().toISOString().split("T")[0];

  const anthropicMessages: Anthropic.MessageParam[] = messages.map((m) => ({
    role:    m.role,
    content: m.content,
  }));

  const stream = await client.messages.stream({
    model:      config.model      ?? "claude-opus-4-7",
    max_tokens: config.maxTokens  ?? 4096,
    system:     SYSTEM_PROMPT(config.merchantName, config.merchantId, config.mode, date),
    tools,
    messages:   anthropicMessages,
  });

  const pendingToolCalls: Array<{
    id:    string;
    name:  string;
    input: Record<string, unknown>;
  }> = [];

  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield { type: "text", delta: event.delta.text };
    }

    if (event.type === "content_block_stop") {
      // Handled below via final message
    }
  }

  const finalMessage = await stream.finalMessage();

  for (const block of finalMessage.content) {
    if (block.type !== "tool_use") continue;

    const toolId    = block.id;
    const toolName  = block.name;
    const toolInput = block.input as Record<string, unknown>;

    yield { type: "tool_call", id: toolId, name: toolName, input: toolInput };

    if (isApprovalRequired(toolName)) {
      const approved = pendingApprovals.get(toolId);
      if (!approved) {
        yield { type: "approval_required", id: toolId, name: toolName, input: toolInput };
        pendingToolCalls.push({ id: toolId, name: toolName, input: toolInput });
        continue;
      }
    }

    let result: unknown;
    try {
      if (
        config.billingEnabled &&
        (toolName === "get_invoice" ||
          toolName === "list_account_invoices" ||
          toolName === "get_account_overdue" ||
          toolName === "retry_failed_payment" ||
          toolName === "apply_credit")
      ) {
        result = await executeBillingTool(
          toolName,
          toolInput,
          config.killBillUrl!,
          config.killBillAuth!
        );
      } else {
        result = await executeCoreToolStub(toolName, toolInput);
      }
    } catch (err) {
      result = { error: String(err) };
    }

    yield { type: "tool_result", id: toolId, name: toolName, result };
  }

  yield { type: "done" };
}
