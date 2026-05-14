import { promises as fs } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type { SkillDefinition } from "./types";

const DEFAULT_PATH = join(homedir(), ".forgepay", "agent", "learned-skills.json");

interface LearnedSkillsFile {
  version:  1;
  skills:   StoredSkill[];
}

interface StoredSkill extends SkillDefinition {
  source:     "learned" | "user-defined";
  createdAt:  string;
  updatedAt:  string;
  usageCount: number;
  avgRating:  number | null;
}

export class DynamicSkillStore {
  private path: string;
  private cache: StoredSkill[] | null = null;

  constructor(path?: string) {
    this.path = path ?? DEFAULT_PATH;
  }

  async load(): Promise<StoredSkill[]> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.path, "utf-8");
      const file = JSON.parse(raw) as LearnedSkillsFile;
      this.cache = file.skills ?? [];
      return this.cache;
    } catch {
      this.cache = [];
      return this.cache;
    }
  }

  async save(): Promise<void> {
    const data: LearnedSkillsFile = { version: 1, skills: this.cache ?? [] };
    await fs.mkdir(dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, JSON.stringify(data, null, 2), "utf-8");
  }

  async createSkill(def: Omit<SkillDefinition, "id"> & { id?: string }): Promise<StoredSkill> {
    await this.load();
    const now = new Date().toISOString();
    const skill: StoredSkill = {
      id:           def.id ?? `learned_${Date.now()}`,
      name:         def.name,
      description:  def.description,
      instructions: def.instructions,
      toolsets:     def.toolsets,
      modes:        def.modes,
      source:       "learned",
      createdAt:    now,
      updatedAt:    now,
      usageCount:   0,
      avgRating:    null,
    };

    // Prevent duplicate IDs
    const existing = this.cache!.findIndex(s => s.id === skill.id);
    if (existing >= 0) {
      skill.id = `${skill.id}_${randomUUID().slice(0, 6)}`;
    }

    this.cache!.push(skill);
    await this.save();
    return skill;
  }

  async updateSkill(id: string, updates: Partial<Pick<StoredSkill, "instructions" | "description" | "toolsets" | "modes">>): Promise<StoredSkill | null> {
    await this.load();
    const skill = this.cache!.find(s => s.id === id);
    if (!skill) return null;
    Object.assign(skill, updates, { updatedAt: new Date().toISOString() });
    await this.save();
    return skill;
  }

  async incrementUsage(id: string): Promise<void> {
    await this.load();
    const skill = this.cache!.find(s => s.id === id);
    if (skill) { skill.usageCount++; await this.save(); }
  }

  async recordRating(id: string, rating: 1 | 2 | 3 | 4 | 5): Promise<void> {
    await this.load();
    const skill = this.cache!.find(s => s.id === id);
    if (!skill) return;
    // Running average
    skill.avgRating = skill.avgRating === null
      ? rating
      : (skill.avgRating * skill.usageCount + rating) / (skill.usageCount + 1);
    await this.save();
  }

  async listAll(): Promise<StoredSkill[]> {
    return this.load();
  }

  async getById(id: string): Promise<StoredSkill | undefined> {
    const skills = await this.load();
    return skills.find(s => s.id === id);
  }

  invalidateCache(): void { this.cache = null; }
}

// Singleton
let _instance: DynamicSkillStore | undefined;
export function getDynamicSkillStore(path?: string): DynamicSkillStore {
  if (!_instance) _instance = new DynamicSkillStore(path);
  return _instance;
}
