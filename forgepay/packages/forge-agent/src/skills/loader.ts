import type { SkillDefinition } from "./types";
import { SKILLS_BY_ID, ALL_SKILLS } from "./definitions";

export function loadSkill(skillId: string): SkillDefinition | undefined {
  return SKILLS_BY_ID.get(skillId);
}

export function loadSkills(skillIds: string[]): SkillDefinition[] {
  return skillIds
    .map(id => SKILLS_BY_ID.get(id))
    .filter((s): s is SkillDefinition => s !== undefined);
}

export function listAvailableSkills(): string[] {
  return ALL_SKILLS.map(s => s.id);
}
