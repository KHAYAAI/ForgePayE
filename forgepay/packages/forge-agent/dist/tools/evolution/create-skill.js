"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
const dynamic_store_1 = require("../../skills/dynamic-store");
registry_1.registry.register({
    definition: {
        name: "create_skill",
        description: "Create a new reusable skill that will be loaded in future sessions. Use this when you identify a repeatable domain expertise pattern specific to this merchant or payment use case. The skill will persist and improve future responses.",
        input_schema: {
            type: "object",
            properties: {
                id: { type: "string", description: "snake_case identifier (e.g. crypto_tax_reporting)" },
                name: { type: "string", description: "Human-readable skill name" },
                description: { type: "string", description: "One sentence description" },
                instructions: { type: "string", description: "Domain-specific instructions this skill adds to the system prompt (2-6 sentences)" },
                toolsets: { type: "array", items: { type: "string" }, description: "Toolsets this skill activates: analytics, payments, customers, subscriptions, crypto, webhooks, billing, memory" },
                modes: { type: "array", items: { type: "string" }, description: "Modes where skill applies: integrate, insight, act" },
            },
            required: ["name", "instructions"],
        },
    },
    parallel: false,
    requiresApproval: false,
    toolsets: ["memory"],
    execute: async (input, _ctx) => {
        const store = (0, dynamic_store_1.getDynamicSkillStore)();
        const skill = await store.createSkill({
            id: input.id,
            name: input.name,
            description: input.description ?? input.name,
            instructions: input.instructions,
            toolsets: (input.toolsets ?? ["analytics"]),
            modes: input.modes ?? ["insight", "act"],
        });
        return {
            created: true,
            skill_id: skill.id,
            message: `Skill "${skill.name}" created and will be available in future sessions.`,
        };
    },
});
//# sourceMappingURL=create-skill.js.map