import type { SkillDefinition } from "./types";
export declare function loadSkill(skillId: string): SkillDefinition | undefined;
export declare function loadSkills(skillIds: string[]): SkillDefinition[];
export declare function loadSkillsWithDynamic(skillIds: string[]): Promise<SkillDefinition[]>;
export declare function listAvailableSkills(): string[];
export declare function listAllSkillIds(): Promise<string[]>;
//# sourceMappingURL=loader.d.ts.map