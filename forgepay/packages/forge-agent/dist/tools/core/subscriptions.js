"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
    definition: {
        name: "list_subscriptions",
        description: "List subscriptions, optionally filtered by status.",
        input_schema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max results (default 20, max 100)",
                },
                status: {
                    type: "string",
                    description: "Filter by status: active | cancelled | paused | past_due",
                },
            },
        },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["subscriptions"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "list_subscriptions", input };
    },
});
registry_1.registry.register({
    definition: {
        name: "cancel_subscription",
        description: "⚠️ REQUIRES APPROVAL. Cancel an active subscription.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: {
                    type: "string",
                    description: "Subscription ID to cancel",
                },
            },
            required: ["subscription_id"],
        },
    },
    parallel: false,
    requiresApproval: true,
    toolsets: ["subscriptions"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "cancel_subscription", input };
    },
});
registry_1.registry.register({
    definition: {
        name: "pause_subscription",
        description: "⚠️ REQUIRES APPROVAL. Pause an active subscription.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: {
                    type: "string",
                    description: "Subscription ID to pause",
                },
            },
            required: ["subscription_id"],
        },
    },
    parallel: false,
    requiresApproval: true,
    toolsets: ["subscriptions"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "pause_subscription", input };
    },
});
registry_1.registry.register({
    definition: {
        name: "resume_subscription",
        description: "⚠️ REQUIRES APPROVAL. Resume a paused subscription.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: {
                    type: "string",
                    description: "Subscription ID to resume",
                },
            },
            required: ["subscription_id"],
        },
    },
    parallel: false,
    requiresApproval: true,
    toolsets: ["subscriptions"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "resume_subscription", input };
    },
});
registry_1.registry.register({
    definition: {
        name: "upgrade_subscription",
        description: "⚠️ REQUIRES APPROVAL. Change a subscription to a different plan.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: {
                    type: "string",
                    description: "Subscription ID to modify",
                },
                plan_id: {
                    type: "string",
                    description: "Target plan ID to switch to",
                },
            },
            required: ["subscription_id", "plan_id"],
        },
    },
    parallel: false,
    requiresApproval: true,
    toolsets: ["subscriptions"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "upgrade_subscription", input };
    },
});
//# sourceMappingURL=subscriptions.js.map