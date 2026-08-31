"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
const TREASURY_URL = process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";
registry_1.registry.register({
    definition: {
        name: "get_netting_summary",
        description: "Calculate intercompany netting summary: gross vs net settlement amounts, fees saved, and net obligations per subsidiary pair.",
        input_schema: { type: "object", properties: {}, required: [] },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["treasury"],
    execute: async (_input, _ctx) => {
        try {
            const res = await fetch(`${TREASURY_URL}/v1/netting/calculate`);
            const body = await res.json();
            const { data, summary, total } = body;
            return {
                summary: {
                    ...summary,
                    totalGrossFormatted: `$${(summary["totalGrossUsd"] ?? 0).toLocaleString()}`,
                    totalNetFormatted: `$${(summary["totalNetUsd"] ?? 0).toLocaleString()}`,
                    feesSavedFormatted: `$${(summary["totalFeesSavedUsd"] ?? 0).toLocaleString()}`,
                    reductionDescription: `${summary["reductionPercent"] ?? 0}% reduction from gross to net`,
                },
                settlementPairs: data,
                pairCount: total,
            };
        }
        catch (err) {
            return { error: "EnterpriseTreasuryUnavailable", message: String(err) };
        }
    },
});
//# sourceMappingURL=netting-summary.js.map