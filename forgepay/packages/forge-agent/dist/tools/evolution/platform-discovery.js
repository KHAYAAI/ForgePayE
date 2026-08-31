"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
// Map of env var → service info
const PLATFORM_SERVICES = [
    {
        envKey: "PAYMENT_ENGINE_URL",
        name: "Payment Engine (Hyperswitch)",
        capabilities: ["card payments", "payment intents", "refunds", "connectors"],
    },
    {
        envKey: "STABLECOIN_GATEWAY_URL",
        name: "Stablecoin Gateway",
        capabilities: ["USDC payments", "USDT payments", "x402 AI payments", "shielded transactions"],
    },
    {
        envKey: "CRYPTO_GATEWAY_URL",
        name: "Crypto Gateway",
        capabilities: ["BTC payments", "ETH payments", "multi-chain support"],
    },
    {
        envKey: "BILLING_ENGINE_URL",
        name: "Billing Engine (Kill Bill)",
        capabilities: ["subscriptions", "invoicing", "dunning", "credits"],
    },
    {
        envKey: "BANK_CONNECTIVITY_URL",
        name: "Bank Connectivity",
        capabilities: ["Plaid bank linking", "Open Banking", "ACH transfers", "balance checking"],
    },
    {
        envKey: "YIELD_ENGINE_URL",
        name: "Yield Engine",
        capabilities: ["Aave V3 yield", "Compound V3 yield", "Ondo USDY", "auto-sweep", "APY comparison"],
    },
    {
        envKey: "LIQUIDITY_FORECASTER_URL",
        name: "Liquidity Forecaster",
        capabilities: ["7/30/90-day cash flow forecasts", "runway calculator", "burn rate alerts"],
    },
    {
        envKey: "COMPLIANCE_MONITOR_URL",
        name: "Compliance Monitor",
        capabilities: ["OFAC screening", "AML transaction monitoring", "SAR reporting", "KYC management"],
    },
    {
        envKey: "MOR_LAYER_URL",
        name: "MoR Layer",
        capabilities: ["tax calculation", "VAT/GST", "multi-currency checkout", "merchant of record"],
    },
];
registry_1.registry.register({
    definition: {
        name: "discover_platform",
        description: "Discover which ForgePay platform services are currently available and what they can do. Use this when asked about platform capabilities, before attempting to access a service you're unsure about, or when helping a merchant understand what features are available to them.",
        input_schema: {
            type: "object",
            properties: {
                check_health: {
                    type: "boolean",
                    description: "If true, ping each service's health endpoint to verify it's actually running (takes longer). Default false.",
                },
            },
        },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["analytics"],
    execute: async (input, _ctx) => {
        const checkHealth = input.check_health ?? false;
        const services = await Promise.all(PLATFORM_SERVICES.map(async (svc) => {
            const url = process.env[svc.envKey];
            if (!url) {
                return { name: svc.name, url: "(not configured)", status: "unavailable", capabilities: svc.capabilities };
            }
            let status = "unknown";
            if (checkHealth) {
                try {
                    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
                    status = res.ok ? "available" : "unavailable";
                }
                catch {
                    status = "unavailable";
                }
            }
            else {
                status = "available"; // Assume available if URL is configured
            }
            return { name: svc.name, url, status, capabilities: svc.capabilities };
        }));
        const available = services.filter(s => s.status === "available");
        const unavailable = services.filter(s => s.status !== "available");
        return {
            total_services: services.length,
            available_count: available.length,
            available: available.map(s => ({ name: s.name, capabilities: s.capabilities })),
            unavailable: unavailable.map(s => ({ name: s.name, reason: "not configured or unreachable" })),
            note: "Configure service URLs via environment variables to enable additional capabilities.",
        };
    },
});
//# sourceMappingURL=platform-discovery.js.map