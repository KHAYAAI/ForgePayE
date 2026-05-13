import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "delegate_task",
    description:
      "Delegate a subtask to a leaf sub-agent and return its result. Use when a task requires independent parallel reasoning.",
    input_schema: {
      type: "object",
      properties: {
        subtask: {
          type: "string",
          description: "The subtask to delegate to the sub-agent",
        },
        context: {
          type: "string",
          description: "Optional additional context to provide to the sub-agent",
        },
      },
      required: ["subtask"],
    },
  },
  parallel: false,
  requiresApproval: false,
  toolsets: ["delegation"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.spawnSubAgent) {
      return { error: "Delegation not available in leaf agent mode" };
    }
    const subtask = input.subtask as string;
    let result = "";
    for await (const event of ctx.spawnSubAgent(subtask)) {
      if (event.type === "text") result += event.delta;
    }
    return { result: result.trim() };
  },
});
