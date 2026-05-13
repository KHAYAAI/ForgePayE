// Mirror of SSEEvent from @forgepay/forge-agent — kept local to avoid cross-package dependency

export type SSEEvent =
  | { type: "text";              delta: string }
  | { type: "tool_call";         id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result";       id: string; name: string; result: unknown }
  | { type: "approval_required"; id: string; name: string; input: Record<string, unknown> }
  | { type: "error";             message: string }
  | { type: "done" }
  | { type: "iteration";     n: number; max: number }
  | { type: "memory_update"; summary?: string }
  | { type: "delegation";    subtask: string; role: "leaf" };
