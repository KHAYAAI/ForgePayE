import * as vscode from "vscode";
import type { SSEEvent } from "./types.js";

export type AgentMode = "integrate" | "insight" | "act";

export interface AgentMessage {
  role:    "user" | "assistant";
  content: string;
}

export interface AgentClientConfig {
  dashboardUrl: string;
  apiKey:       string;
}

export class AgentClient {
  private messages: AgentMessage[] = [];
  private approvals: Record<string, boolean> = {};

  constructor(private config: AgentClientConfig) {}

  async *sendMessage(
    text: string,
    mode: AgentMode,
    onApprovalRequired: (id: string, name: string, input: unknown) => Promise<boolean>
  ): AsyncGenerator<SSEEvent> {
    this.messages.push({ role: "user", content: text });

    const res = await fetch(`${this.config.dashboardUrl}/api/agent/chat`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        Authorization:   `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        messages:  this.messages,
        mode,
        approvals: this.approvals,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Forge Agent error ${res.status}: ${err}`);
    }

    if (!res.body) throw new Error("No response body");

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   buffer  = "";
    let   assistantText = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const event = JSON.parse(line.slice(6)) as SSEEvent;

        if (event.type === "text") {
          assistantText += event.delta;
        }

        if (event.type === "approval_required") {
          const approved = await onApprovalRequired(
            event.id,
            event.name,
            event.input
          );
          this.approvals[event.id] = approved;
        }

        yield event;
      }
    }

    if (assistantText) {
      this.messages.push({ role: "assistant", content: assistantText });
    }
  }

  clearHistory() {
    this.messages  = [];
    this.approvals = {};
  }
}
