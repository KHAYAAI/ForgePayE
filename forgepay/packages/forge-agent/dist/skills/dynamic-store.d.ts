import type { SkillDefinition } from "./types";
interface StoredSkill extends SkillDefinition {
    source: "learned" | "user-defined";
    createdAt: string;
    updatedAt: string;
    usageCount: number;
    avgRating: number | null;
}
export declare class DynamicSkillStore {
    private path;
    private cache;
    constructor(path?: string);
    load(): Promise<StoredSkill[]>;
    save(): Promise<void>;
    createSkill(def: Omit<SkillDefinition, "id"> & {
        id?: string;
    }): Promise<StoredSkill>;
    updateSkill(id: string, updates: Partial<Pick<StoredSkill, "instructions" | "description" | "toolsets" | "modes">>): Promise<StoredSkill | null>;
    incrementUsage(id: string): Promise<void>;
    recordRating(id: string, rating: 1 | 2 | 3 | 4 | 5): Promise<void>;
    listAll(): Promise<StoredSkill[]>;
    getById(id: string): Promise<StoredSkill | undefined>;
    invalidateCache(): void;
}
export declare function getDynamicSkillStore(path?: string): DynamicSkillStore;
export {};
//# sourceMappingURL=dynamic-store.d.ts.map