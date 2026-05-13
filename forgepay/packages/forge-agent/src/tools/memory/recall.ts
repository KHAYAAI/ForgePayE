import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "memory_recall",
    description: "Recall previously stored context and notes for this merchant session.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["memory"],
  execute: async (_input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.memoryStore) return { memory: "" };
    const memory = await ctx.memoryStore.recall(ctx.merchantId);
    return { memory: memory || "No stored context yet." };
  },
});
