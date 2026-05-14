import { registry } from "../../core/registry";
import { getDynamicSkillStore } from "../../skills/dynamic-store";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "create_skill",
    description: "Create a new reusable skill that will be loaded in future sessions. Use this when you identify a repeatable domain expertise pattern specific to this merchant or payment use case. The skill will persist and improve future responses.",
    input_schema: {
      type: "object",
      properties: {
        id:           { type: "string",  description: "snake_case identifier (e.g. crypto_tax_reporting)" },
        name:         { type: "string",  description: "Human-readable skill name" },
        description:  { type: "string",  description: "One sentence description" },
        instructions: { type: "string",  description: "Domain-specific instructions this skill adds to the system prompt (2-6 sentences)" },
        toolsets:     { type: "array",   items: { type: "string" }, description: "Toolsets this skill activates: analytics, payments, customers, subscriptions, crypto, webhooks, billing, memory" },
        modes:        { type: "array",   items: { type: "string" }, description: "Modes where skill applies: integrate, insight, act" },
      },
      required: ["name", "instructions"],
    },
  },
  parallel:         false,
  requiresApproval: false,
  toolsets:         ["memory"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    const store = getDynamicSkillStore();
    const skill = await store.createSkill({
      id:           input.id as string | undefined,
      name:         input.name as string,
      description:  (input.description as string | undefined) ?? (input.name as string),
      instructions: input.instructions as string,
      toolsets:     (input.toolsets as string[] | undefined) ?? ["analytics"],
      modes:        (input.modes as string[] | undefined) ?? ["insight", "act"],
    });
    return {
      created: true,
      skill_id: skill.id,
      message: `Skill "${skill.name}" created and will be available in future sessions.`,
    };
  },
});
