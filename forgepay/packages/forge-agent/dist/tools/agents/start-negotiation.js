"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
const NEGOTIATION_URL = process.env["AGENT_NEGOTIATION_URL"] ?? "http://localhost:3011";
registry_1.registry.register({
    definition: {
        name: "start_negotiation",
        description: "Start a structured negotiation session with another AI agent. Supports offer/counter-offer protocol with escrow for safe settlement.",
        input_schema: {
            type: "object",
            properties: {
                initiatorAgentId: { type: "string", description: "ID of the initiating agent (you)" },
                responderAgentId: { type: "string", description: "ID of the agent to negotiate with" },
                subject: { type: "string", description: "What is being negotiated (e.g. 'API access 30 days', 'Data feed subscription')" },
                initialTerms: {
                    type: "array",
                    description: "Initial offer terms",
                    items: {
                        type: "object",
                        properties: {
                            key: { type: "string" },
                            value: {},
                            unit: { type: "string" },
                        },
                        required: ["key", "value"],
                    },
                },
                maxRounds: { type: "number", description: "Maximum negotiation rounds before auto-reject (default 10)" },
            },
            required: ["initiatorAgentId", "responderAgentId", "subject", "initialTerms"],
        },
    },
    parallel: false,
    requiresApproval: false,
    toolsets: ["agents"],
    execute: async (input) => {
        try {
            const res = await fetch(`${NEGOTIATION_URL}/v1/sessions`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(input),
            });
            return res.json();
        }
        catch (err) {
            return { error: "AgentNegotiationUnavailable", message: String(err) };
        }
    },
});
//# sourceMappingURL=start-negotiation.js.map