import type { AgentMode } from "./types";
import type { SystemBlock } from "./provider";
import type { SkillDefinition } from "../skills/types";
export interface PromptParts {
    merchantName: string;
    merchantId: string;
    mode: AgentMode;
    date: string;
    merchantMemory?: string;
    activeSkills: SkillDefinition[];
}
export declare function buildSystemPrompt(parts: PromptParts): SystemBlock[];
export declare function baseInstructions(): string;
export declare function toolsetCapabilities(mode: AgentMode): string;
//# sourceMappingURL=prompt-builder.d.ts.map