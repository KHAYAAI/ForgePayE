import { registry } from "../../core/registry";
import { ALL_SKILLS } from "../../skills/definitions";
import { getDynamicSkillStore } from "../../skills/dynamic-store";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "list_skills",
    description: "List all available skills (both built-in and learned). Use to check what expertise the agent has, or before creating a new skill to avoid duplicates.",
    input_schema: { type: "object", properties: {} },
  },
  parallel:         true,
  requiresApproval: false,
  toolsets:         ["memory"],
  execute: async (_input, _ctx: ToolContext): Promise<unknown> => {
    const dynamicStore = getDynamicSkillStore();
    const dynamic = await dynamicStore.listAll();
    return {
      builtin_skills: ALL_SKILLS.map(s => ({
        id: s.id, name: s.name, description: s.description, modes: s.modes,
      })),
      learned_skills: dynamic.map(s => ({
        id: s.id, name: s.name, description: s.description, modes: s.modes,
        usage_count: s.usageCount, avg_rating: s.avgRating, created_at: s.createdAt,
      })),
    };
  },
});
