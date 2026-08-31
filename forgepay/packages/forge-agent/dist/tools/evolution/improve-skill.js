"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../../core/registry");
const dynamic_store_1 = require("../../skills/dynamic-store");
registry_1.registry.register({
    definition: {
        name: "improve_skill",
        description: "Update an existing learned skill with improved instructions. Use when you discover better ways to handle a domain or when a skill's instructions need refinement based on what worked in this session.",
        input_schema: {
            type: "object",
            properties: {
                skill_id: { type: "string", description: "ID of the skill to improve" },
                instructions: { type: "string", description: "Updated instructions (replace existing)" },
                description: { type: "string", description: "Updated description (optional)" },
            },
            required: ["skill_id", "instructions"],
        },
    },
    parallel: false,
    requiresApproval: false,
    toolsets: ["memory"],
    execute: async (input, _ctx) => {
        const store = (0, dynamic_store_1.getDynamicSkillStore)();
        const updated = await store.updateSkill(input.skill_id, {
            instructions: input.instructions,
            description: input.description,
        });
        if (!updated) {
            return { updated: false, error: `Skill "${input.skill_id}" not found. Use create_skill to create it.` };
        }
        return { updated: true, skill_id: updated.id, message: `Skill "${updated.name}" updated.` };
    },
});
//# sourceMappingURL=improve-skill.js.map