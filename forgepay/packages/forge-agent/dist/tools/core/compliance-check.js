"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_js_1 = require("../../core/registry.js");
registry_js_1.registry.register({
    definition: {
        name: "check_compliance_status",
        description: "Screen a counterparty (customer, agent, or address) against OFAC sanctions, EU/UK sanctions lists, and AML rules. Returns risk score and any flags.",
        input_schema: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Full name of the individual or entity to screen",
                },
                country: {
                    type: "string",
                    description: "ISO 2-letter country code (e.g. 'US', 'DE', 'RU')",
                },
                walletAddress: {
                    type: "string",
                    description: "Optional Ethereum/Bitcoin wallet address to screen against crypto sanction lists",
                },
                customerId: {
                    type: "string",
                    description: "Optional ForgePay customer ID for existing customer screening",
                },
            },
            required: ["name"],
        },
    },
    execute: async (input, _ctx) => {
        const name = input["name"];
        const country = input["country"];
        const walletAddress = input["walletAddress"];
        const customerId = input["customerId"];
        try {
            const payload = { name };
            if (country)
                payload.country = country;
            if (walletAddress)
                payload.wallet_address = walletAddress;
            if (customerId)
                payload.customer_id = customerId;
            const res = await fetch("http://localhost:8003/v1/screening/check", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                return {
                    error: `Compliance service returned ${res.status}`,
                    riskLevel: "unknown",
                };
            }
            return res.json();
        }
        catch {
            return {
                riskLevel: "unknown",
                flags: [],
                note: "Compliance monitor unavailable — manual review required",
            };
        }
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["analytics"],
});
//# sourceMappingURL=compliance-check.js.map