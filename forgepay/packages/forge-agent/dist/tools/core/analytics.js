"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
    definition: {
        name: "get_analytics",
        description: "Retrieve revenue, payment volume, and churn metrics for a date range.",
        input_schema: {
            type: "object",
            properties: {
                start_date: {
                    type: "string",
                    description: "ISO 8601 date string (e.g. 2026-01-01)",
                },
                end_date: {
                    type: "string",
                    description: "ISO 8601 date string (e.g. 2026-01-31)",
                },
            },
            required: ["start_date", "end_date"],
        },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["analytics"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "get_analytics", input };
    },
});
//# sourceMappingURL=analytics.js.map