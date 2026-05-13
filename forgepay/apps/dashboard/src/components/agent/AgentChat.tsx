"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Bot, Lock, Send, ChevronDown, ChevronRight, AlertTriangle, Check, X } from "lucide-react";
import type { AgentMode, SSEEvent } from "@forgepay/forge-agent";

// ── Types ─────────────────────────────────────────────────────────────────

type MessageRole = "user" | "assistant";

interface TextMessage {
  type:    "text";
  role:    MessageRole;
  content: string;
}

interface ToolCallMessage {
  type:     "tool_call";
  id:       string;
  name:     string;
  input:    Record<string, unknown>;
  result?:  unknown;
  expanded: boolean;
}

interface ApprovalMessage {
  type:    "approval";
  id:      string;
  name:    string;
  input:   Record<string, unknown>;
  status:  "pending" | "approved" | "rejected";
}

type ChatMessage = TextMessage | ToolCallMessage | ApprovalMessage;

// ── Helpers ───────────────────────────────────────────────────────────────

function modeLabel(mode: AgentMode): string {
  if (mode === "integrate") return "Integrate";
  if (mode === "insight")   return "Insight";
  return "Act";
}

function modeDescription(mode: AgentMode): string {
  if (mode === "integrate") return "Get integration code and SDK examples";
  if (mode === "insight")   return "Query analytics and read-only data";
  return "Take actions: refunds, subscription changes";
}

// ── Sub-components ────────────────────────────────────────────────────────

function ToolCard({
  msg,
  onToggle,
}: {
  msg: ToolCallMessage;
  onToggle: () => void;
}) {
  return (
    <div className="my-1 rounded border border-gray-200 bg-gray-50 text-sm font-mono">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-gray-600 hover:bg-gray-100"
      >
        {msg.expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0" />
        )}
        <span className="font-semibold text-gray-800">{msg.name}</span>
        {msg.result && (
          <span className="ml-auto text-xs text-green-600">✓ done</span>
        )}
      </button>
      {msg.expanded && (
        <div className="border-t border-gray-200 px-3 py-2 text-xs">
          <div className="mb-1 text-gray-500">Input</div>
          <pre className="overflow-x-auto text-gray-700">
            {JSON.stringify(msg.input, null, 2)}
          </pre>
          {msg.result !== undefined && (
            <>
              <div className="mb-1 mt-2 text-gray-500">Result</div>
              <pre className="overflow-x-auto text-gray-700">
                {JSON.stringify(msg.result, null, 2)}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ApprovalCard({
  msg,
  onDecision,
}: {
  msg:        ApprovalMessage;
  onDecision: (id: string, approved: boolean) => void;
}) {
  return (
    <div className="my-2 rounded border border-yellow-300 bg-yellow-50 p-3 text-sm">
      <div className="mb-2 flex items-center gap-2 font-semibold text-yellow-800">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        Approval required — <span className="font-mono">{msg.name}</span>
      </div>
      <pre className="mb-3 overflow-x-auto rounded bg-yellow-100 px-2 py-1 text-xs text-yellow-900">
        {JSON.stringify(msg.input, null, 2)}
      </pre>
      {msg.status === "pending" ? (
        <div className="flex gap-2">
          <button
            onClick={() => onDecision(msg.id, true)}
            className="flex items-center gap-1 rounded bg-[#0A2540] px-3 py-1 text-xs font-semibold text-white hover:bg-[#0d3060]"
          >
            <Check className="h-3 w-3" /> Confirm
          </button>
          <button
            onClick={() => onDecision(msg.id, false)}
            className="flex items-center gap-1 rounded border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            <X className="h-3 w-3" /> Cancel
          </button>
        </div>
      ) : (
        <div
          className={`text-xs font-semibold ${
            msg.status === "approved" ? "text-green-700" : "text-red-600"
          }`}
        >
          {msg.status === "approved" ? "✓ Approved" : "✗ Cancelled"}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export default function AgentChat({ enabled }: { enabled: boolean }) {
  const [mode, setMode]               = useState<AgentMode>("insight");
  const [input, setInput]             = useState("");
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [loading, setLoading]         = useState(false);
  const [approvals, setApprovals]     = useState<Record<string, boolean>>({});
  const [iterationCount, setIterationCount] = useState(0);
  const bottomRef                 = useRef<HTMLDivElement>(null);
  const textareaRef               = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const toggleToolCard = useCallback((id: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.type === "tool_call" && m.id === id
          ? { ...m, expanded: !m.expanded }
          : m
      )
    );
  }, []);

  const handleApprovalDecision = useCallback(
    (id: string, approved: boolean) => {
      setApprovals((prev) => ({ ...prev, [id]: approved }));
      setMessages((prev) =>
        prev.map((m) =>
          m.type === "approval" && m.id === id
            ? { ...m, status: approved ? "approved" : "rejected" }
            : m
        )
      );
    },
    []
  );

  const sendMessage = useCallback(
    async (text: string, currentApprovals: Record<string, boolean>) => {
      if (!text.trim() || loading) return;

      const userMsg: TextMessage = { type: "text", role: "user", content: text };
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setLoading(true);
      setIterationCount(0);

      // Build conversation history for API
      const history = [...messages, userMsg]
        .filter((m): m is TextMessage => m.type === "text")
        .map((m) => ({ role: m.role, content: m.content }));

      try {
        const res = await fetch("/api/agent/chat", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ messages: history, mode, approvals: currentApprovals }),
        });

        if (!res.body) throw new Error("No response body");

        const reader  = res.body.getReader();
        const decoder = new TextDecoder();
        let   buffer  = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const event = JSON.parse(line.slice(6)) as SSEEvent & { type: string };

            if (event.type === "text") {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.type === "text" && last.role === "assistant") {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, content: last.content + event.delta },
                  ];
                }
                return [
                  ...prev,
                  { type: "text", role: "assistant", content: event.delta },
                ];
              });
            }

            if (event.type === "tool_call") {
              setMessages((prev) => [
                ...prev,
                {
                  type:     "tool_call",
                  id:       event.id,
                  name:     event.name,
                  input:    event.input,
                  expanded: false,
                },
              ]);
            }

            if (event.type === "tool_result") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.type === "tool_call" && m.id === event.id
                    ? { ...m, result: event.result }
                    : m
                )
              );
            }

            if (event.type === "approval_required") {
              setMessages((prev) => [
                ...prev,
                {
                  type:   "approval",
                  id:     event.id,
                  name:   event.name,
                  input:  event.input,
                  status: "pending",
                },
              ]);
            }

            if (event.type === "iteration") {
              setIterationCount(event.n);
            }

            if (event.type === "memory_update") {
              setMessages((prev) => [
                ...prev,
                {
                  type:    "text",
                  role:    "assistant",
                  content: `ℹ️ Memory updated${event.summary ? `: ${event.summary}` : ""}`,
                },
              ]);
            }

            if (event.type === "delegation") {
              setMessages((prev) => [
                ...prev,
                {
                  type:     "tool_call",
                  id:       `delegation-${Date.now()}`,
                  name:     "delegate_task",
                  input:    { subtask: event.subtask, role: event.role },
                  expanded: false,
                },
              ]);
            }
          }
        }
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            type:    "text",
            role:    "assistant",
            content: `Error: ${String(err)}`,
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [loading, messages, mode]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input, approvals);
    }
  };

  const modes: AgentMode[] = ["integrate", "insight", "act"];

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {/* Coming Soon overlay */}
      {!enabled && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-white/80 backdrop-blur-sm">
          <Lock className="h-10 w-10 text-[#0A2540]" />
          <div className="text-center">
            <div className="text-lg font-semibold text-[#0A2540]">Coming Soon</div>
            <div className="mt-1 text-sm text-gray-500">
              Forge Agent is being prepared for launch
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0A2540]">
          <Bot className="h-4 w-4 text-[#00F0FF]" />
        </div>
        <div>
          <div className="text-sm font-semibold text-[#0A2540]">Forge Agent</div>
          <div className="text-xs text-gray-500">{modeDescription(mode)}</div>
        </div>
      </div>

      {/* Mode selector */}
      <div className="flex gap-1 border-b border-gray-100 px-4 py-2">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              mode === m
                ? "bg-[#0A2540] text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {modeLabel(m)}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {messages.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            {mode === "integrate"
              ? "Ask for SDK code snippets, integration guides, or setup help."
              : mode === "insight"
              ? "Ask about revenue, churn, payment trends, or customer data."
              : "Ask to refund a payment, cancel a subscription, or apply a credit."}
          </div>
        )}

        {messages.map((msg, i) => {
          if (msg.type === "text") {
            return (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-[#00F0FF] text-[#0A2540]"
                      : "bg-gray-100 text-gray-800"
                  }`}
                >
                  <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                </div>
              </div>
            );
          }

          if (msg.type === "tool_call") {
            return (
              <ToolCard
                key={msg.id}
                msg={msg}
                onToggle={() => toggleToolCard(msg.id)}
              />
            );
          }

          if (msg.type === "approval") {
            return (
              <ApprovalCard
                key={msg.id}
                msg={msg}
                onDecision={handleApprovalDecision}
              />
            );
          }

          return null;
        })}

        {loading && (
          <div className="flex justify-start items-center gap-2">
            <div className="rounded-2xl bg-gray-100 px-4 py-2 text-sm text-gray-500">
              <span className="animate-pulse">Thinking…</span>
            </div>
            {iterationCount > 0 && (
              <span className="rounded-full bg-[#0A2540] px-2 py-0.5 text-xs font-semibold text-[#00F0FF]">
                {iterationCount}
              </span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Forge Agent… (Enter to send, Shift+Enter for newline)"
            rows={1}
            disabled={loading || !enabled}
            className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-[#00F0FF] focus:outline-none focus:ring-1 focus:ring-[#00F0FF] disabled:opacity-50"
            style={{ maxHeight: "8rem", overflowY: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <button
            onClick={() => sendMessage(input, approvals)}
            disabled={loading || !input.trim() || !enabled}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0A2540] text-white hover:bg-[#0d3060] disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
