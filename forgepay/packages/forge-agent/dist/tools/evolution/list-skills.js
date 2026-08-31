"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
const definitions_1 = require("../../skills/definitions");
const dynamic_store_1 = require("../../skills/dynamic-store");
registry_1.registry.register({
    definition: {
        name: "list_skills",
        description: "List all available skills (both built-in and learned). Use to check what expertise the agent has, or before creating a new skill to avoid duplicates.",
        input_schema: { type: "object", properties: {} },
    },
    parallel: true,
    requiresApproval: false,
    toolsets: ["memory"],
    execute: async (_input, _ctx) => {
        const dynamicStore = (0, dynamic_store_1.getDynamicSkillStore)();
        const dynamic = await dynamicStore.listAll();
        return {
            builtin_skills: definitions_1.ALL_SKILLS.map(s => ({
                id: s.id, name: s.name, description: s.description, modes: s.modes,
            })),
            learned_skills: dynamic.map(s => ({
                id: s.id, name: s.name, description: s.description, modes: s.modes,
                usage_count: s.usageCount, avg_rating: s.avgRating, created_at: s.createdAt,
            })),
        };
    },
});
//# sourceMappingURL=list-skills.js.map