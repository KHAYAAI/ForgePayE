import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "memory_store",
    description: "Store a key/value note in persistent memory for this merchant.",
    input_schema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          description: "The key to store the value under",
        },
        value: {
          type: "string",
          description: "The value to persist",
        },
      },
      required: ["key", "value"],
    },
  },
  parallel: false,
  requiresApproval: false,
  toolsets: ["memory"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.memoryStore) return { stored: false, reason: "Memory not enabled" };
    await ctx.memoryStore.store(ctx.merchantId, input.key as string, input.value as string);
    return { stored: true, key: input.key };
  },
});
