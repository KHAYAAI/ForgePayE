"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
registry_1.registry.register({
    definition: {
        name: "list_customers",
        description: "List customers, optionally filtered by email.",
        input_schema: {
            type: "object",
            properties: {
                limit: {
                    type: "number",
                    description: "Max results (default 20, max 100)",
                },
                email: {
                    type: "string",
                    description: "Filter by email address",
                },
            },
        },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["customers"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "list_customers", input };
    },
});
registry_1.registry.register({
    definition: {
        name: "get_customer",
        description: "Retrieve a single customer by ID.",
        input_schema: {
            type: "object",
            properties: {
                customer_id: {
                    type: "string",
                    description: "Customer ID (e.g. cust_xxx)",
                },
            },
            required: ["customer_id"],
        },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["customers"],
    execute: async (input, _ctx) => {
        return { stub: true, tool: "get_customer", input };
    },
});
//# sourceMappingURL=customers.js.map