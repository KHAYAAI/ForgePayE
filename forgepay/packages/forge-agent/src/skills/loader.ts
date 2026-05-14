import type { SkillDefinition } from "./types";
import { SKILLS_BY_ID, ALL_SKILLS } from "./definitions";
import { getDynamicSkillStore } from "./dynamic-store";

export function loadSkill(skillId: string): SkillDefinition | undefined {
  return SKILLS_BY_ID.get(skillId);
}

// Sync version for static skills only (used in agent loop where async isn't available)
export function loadSkills(skillIds: string[]): SkillDefinition[] {
  return skillIds
    .map(id => SKILLS_BY_ID.get(id))
    .filter((s): s is SkillDefinition => s !== undefined);
}

// Async version that includes dynamically learned skills
export async function loadSkillsWithDynamic(skillIds: string[]): Promise<SkillDefinition[]> {
  const staticSkills = loadSkills(skillIds);
  const dynamicStore = getDynamicSkillStore();
  const allDynamic = await dynamicStore.listAll();

  // Include dynamic skills if their ID is in skillIds OR if skillIds includes "all_learned"
  const includeAll = skillIds.includes("all_learned");
  const dynamicSkills = allDynamic.filter(s => includeAll || skillIds.includes(s.id));

  return [...staticSkills, ...dynamicSkills];
}

export function listAvailableSkills(): string[] {
  return ALL_SKILLS.map(s => s.id);
}

// Returns static + dynamic skill IDs (async)
export async function listAllSkillIds(): Promise<string[]> {
  const staticIds = listAvailableSkills();
  const dynamicStore = getDynamicSkillStore();
  const dynamic = await dynamicStore.listAll();
  return [...staticIds, ...dynamic.map(s => s.id)];
}
