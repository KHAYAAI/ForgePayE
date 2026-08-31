"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
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
    execute: async (input, ctx) => {
        if (!ctx.memoryStore)
            return { stored: false, reason: "Memory not enabled" };
        await ctx.memoryStore.store(ctx.merchantId, input.key, input.value);
        return { stored: true, key: input.key };
    },
});
//# sourceMappingURL=store.js.map