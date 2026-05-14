import { registry } from "../../core/registry";
import { getDynamicSkillStore } from "../../skills/dynamic-store";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "improve_skill",
    description: "Update an existing learned skill with improved instructions. Use when you discover better ways to handle a domain or when a skill's instructions need refinement based on what worked in this session.",
    input_schema: {
      type: "object",
      properties: {
        skill_id:     { type: "string", description: "ID of the skill to improve" },
        instructions: { type: "string", description: "Updated instructions (replace existing)" },
        description:  { type: "string", description: "Updated description (optional)" },
      },
      required: ["skill_id", "instructions"],
    },
  },
  parallel:         false,
  requiresApproval: false,
  toolsets:         ["memory"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    const store = getDynamicSkillStore();
    const updated = await store.updateSkill(input.skill_id as string, {
      instructions: input.instructions as string,
      description:  input.description as string | undefined,
    });
    if (!updated) {
      return { updated: false, error: `Skill "${input.skill_id}" not found. Use create_skill to create it.` };
    }
    return { updated: true, skill_id: updated.id, message: `Skill "${updated.name}" updated.` };
  },
});
