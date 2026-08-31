"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
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
    execute: async (_input, ctx) => {
        if (!ctx.memoryStore)
            return { memory: "" };
        const memory = await ctx.memoryStore.recall(ctx.merchantId);
        return { memory: memory || "No stored context yet." };
    },
});
//# sourceMappingURL=recall.js.map