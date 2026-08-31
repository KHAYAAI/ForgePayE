"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamicSkillStore = void 0;
exports.getDynamicSkillStore = getDynamicSkillStore;
const fs_1 = require("fs");
const path_1 = require("path");
const os_1 = require("os");
const crypto_1 = require("crypto");
const DEFAULT_PATH = (0, path_1.join)((0, os_1.homedir)(), ".forgepay", "agent", "learned-skills.json");
class DynamicSkillStore {
    constructor(path) {
        this.cache = null;
        this.path = path ?? DEFAULT_PATH;
    }
    async load() {
        if (this.cache)
            return this.cache;
        try {
            const raw = await fs_1.promises.readFile(this.path, "utf-8");
            const file = JSON.parse(raw);
            this.cache = file.skills ?? [];
            return this.cache;
        }
        catch {
            this.cache = [];
            return this.cache;
        }
    }
    async save() {
        const data = { version: 1, skills: this.cache ?? [] };
        await fs_1.promises.mkdir((0, path_1.dirname)(this.path), { recursive: true });
        await fs_1.promises.writeFile(this.path, JSON.stringify(data, null, 2), "utf-8");
    }
    async createSkill(def) {
        await this.load();
        const now = new Date().toISOString();
        const skill = {
            id: def.id ?? `learned_${Date.now()}`,
            name: def.name,
            description: def.description,
            instructions: def.instructions,
            toolsets: def.toolsets,
            modes: def.modes,
            source: "learned",
            createdAt: now,
            updatedAt: now,
            usageCount: 0,
            avgRating: null,
        };
        // Prevent duplicate IDs
        const existing = this.cache.findIndex(s => s.id === skill.id);
        if (existing >= 0) {
            skill.id = `${skill.id}_${(0, crypto_1.randomUUID)().slice(0, 6)}`;
        }
        this.cache.push(skill);
        await this.save();
        return skill;
    }
    async updateSkill(id, updates) {
        await this.load();
        const skill = this.cache.find(s => s.id === id);
        if (!skill)
            return null;
        Object.assign(skill, updates, { updatedAt: new Date().toISOString() });
        await this.save();
        return skill;
    }
    async incrementUsage(id) {
        await this.load();
        const skill = this.cache.find(s => s.id === id);
        if (skill) {
            skill.usageCount++;
            await this.save();
        }
    }
    async recordRating(id, rating) {
        await this.load();
        const skill = this.cache.find(s => s.id === id);
        if (!skill)
            return;
        // Running average
        skill.avgRating = skill.avgRating === null
            ? rating
            : (skill.avgRating * skill.usageCount + rating) / (skill.usageCount + 1);
        await this.save();
    }
    async listAll() {
        return this.load();
    }
    async getById(id) {
        const skills = await this.load();
        return skills.find(s => s.id === id);
    }
    invalidateCache() { this.cache = null; }
}
exports.DynamicSkillStore = DynamicSkillStore;
// Singleton
let _instance;
function getDynamicSkillStore(path) {
    if (!_instance)
        _instance = new DynamicSkillStore(path);
    return _instance;
}
//# sourceMappingURL=dynamic-store.js.map