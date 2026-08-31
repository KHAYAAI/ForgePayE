"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
    definition: {
        name: "submit_feedback",
        description: "Submit feedback on the agent's response quality. The merchant can call this to rate the helpfulness of this session (1-5 stars) and optionally provide a comment. This improves future responses.",
        input_schema: {
            type: "object",
            properties: {
                rating: { type: "number", description: "Rating from 1 (poor) to 5 (excellent)" },
                comment: { type: "string", description: "Optional feedback comment" },
                aspect: { type: "string", description: "What aspect: accuracy | completeness | clarity | tool_use | overall" },
            },
            required: ["rating"],
        },
    },
    parallel: false,
    requiresApproval: false,
    toolsets: ["memory"],
    execute: async (input, ctx) => {
        const rating = Math.min(5, Math.max(1, Math.round(input.rating)));
        // Store feedback in memory
        if (ctx.memoryStore) {
            const key = `feedback_${new Date().toISOString().slice(0, 10)}`;
            const value = JSON.stringify({
                rating,
                comment: input.comment,
                aspect: input.aspect ?? "overall",
                timestamp: new Date().toISOString(),
            });
            await ctx.memoryStore.store(ctx.merchantId, key, value);
        }
        const responses = {
            1: "Thank you for the feedback. I'll work to improve.",
            2: "Thanks — I'll aim to do better next time.",
            3: "Appreciate the feedback!",
            4: "Glad I could help!",
            5: "Wonderful! Happy to assist.",
        };
        return {
            received: true,
            rating,
            message: responses[rating],
        };
    },
});
//# sourceMappingURL=submit-feedback.js.map