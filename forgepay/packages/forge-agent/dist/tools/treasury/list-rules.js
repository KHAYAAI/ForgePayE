"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
const TREASURY_URL = process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";
registry_1.registry.register({
    definition: {
        name: "list_treasury_rules",
        description: "List all treasury automation rules (cash sweeps, tax escrow, CFO alerts) including enabled status, trigger conditions, and execution history.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["treasury"],
    execute: async (_input, _ctx) => {
        try {
            const res = await fetch(`${TREASURY_URL}/v1/rules`);
            return res.json();
        }
        catch (err) {
            return { error: "EnterpriseTreasuryUnavailable", message: String(err) };
        }
    },
});
//# sourceMappingURL=list-rules.js.map