"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadSkill = loadSkill;
exports.loadSkills = loadSkills;
exports.loadSkillsWithDynamic = loadSkillsWithDynamic;
exports.listAvailableSkills = listAvailableSkills;
exports.listAllSkillIds = listAllSkillIds;
const definitions_1 = require("./definitions");
const dynamic_store_1 = require("./dynamic-store");
function loadSkill(skillId) {
    return definitions_1.SKILLS_BY_ID.get(skillId);
}
// Sync version for static skills only (used in agent loop where async isn't available)
function loadSkills(skillIds) {
    return skillIds
        .map(id => definitions_1.SKILLS_BY_ID.get(id))
        .filter((s) => s !== undefined);
}
// Async version that includes dynamically learned skills
async function loadSkillsWithDynamic(skillIds) {
    const staticSkills = loadSkills(skillIds);
    const dynamicStore = (0, dynamic_store_1.getDynamicSkillStore)();
    const allDynamic = await dynamicStore.listAll();
    // Include dynamic skills if their ID is in skillIds OR if skillIds includes "all_learned"
    const includeAll = skillIds.includes("all_learned");
    const dynamicSkills = allDynamic.filter(s => includeAll || skillIds.includes(s.id));
    return [...staticSkills, ...dynamicSkills];
}
function listAvailableSkills() {
    return definitions_1.ALL_SKILLS.map(s => s.id);
}
// Returns static + dynamic skill IDs (async)
async function listAllSkillIds() {
    const staticIds = listAvailableSkills();
    const dynamicStore = (0, dynamic_store_1.getDynamicSkillStore)();
    const dynamic = await dynamicStore.listAll();
    return [...staticIds, ...dynamic.map(s => s.id)];
}
//# sourceMappingURL=loader.js.map