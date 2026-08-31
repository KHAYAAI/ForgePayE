"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
    definition: {
        name: "get_webhook_status",
        description: "List configured webhooks and their recent delivery status.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["webhooks"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "get_webhook_status", input };
    },
});
//# sourceMappingURL=webhooks.js.map