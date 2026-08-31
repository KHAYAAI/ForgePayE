"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_js_1 = require("../../core/registry.js");
registry_js_1.registry.register({
    definition: {
        name: "get_liquidity_forecast",
        description: "Get cash flow forecast and runway analysis for the merchant. Returns 7/30/90 day projections with confidence intervals and burn rate analysis.",
        input_schema: {
            type: "object",
            properties: {
                daysAhead: {
                    type: "number",
                    description: "Number of days to forecast ahead (7, 30, or 90). Defaults to 30.",
                },
                scenario: {
                    type: "string",
                    enum: ["conservative", "base", "optimistic"],
                    description: "Scenario to use for forecast. conservative = -20% revenue, base = historical average, optimistic = +20% revenue",
                },
            },
        },
    },
    execute: async (input, ctx) => {
        try {
            const days = input.daysAhead ?? 30;
            const scenario = input.scenario ?? "base";
            const res = await fetch(`http://localhost:8002/v1/forecasts?merchant_id=${ctx.merchantId}&days=${days}&scenario=${scenario}`);
            if (!res.ok) {
                return {
                    error: `Forecaster returned ${res.status}`,
                    note: "Try again or check liquidity-forecaster service health",
                };
            }
            return res.json();
        }
        catch {
            return {
                note: "Liquidity forecaster unavailable",
                merchantId: ctx.merchantId,
                daysAhead: input.daysAhead ?? 30,
            };
        }
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["analytics"],
});
//# sourceMappingURL=get-forecast.js.map