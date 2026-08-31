"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
// Importing the barrel triggers self-registration of all tools
require("../tools/toolsets");
const registry_1 = require("../core/registry");
// Test the ToolRegistry singleton
(0, vitest_1.describe)("ToolRegistry", () => {
    (0, vitest_1.it)("registers tools and lists them", () => {
        const names = registry_1.registry.listNames();
        (0, vitest_1.expect)(names).toContain("get_analytics");
        (0, vitest_1.expect)(names).toContain("refund_payment");
        (0, vitest_1.expect)(names).toContain("memory_recall");
        (0, vitest_1.expect)(names).toContain("delegate_task");
    });
    (0, vitest_1.it)("getDefinitions filters by toolset", () => {
        const defs = registry_1.registry.getDefinitions(["analytics"]);
        (0, vitest_1.expect)(defs.some(d => d.name === "get_analytics")).toBe(true);
        (0, vitest_1.expect)(defs.some(d => d.name === "refund_payment")).toBe(false);
    });
    (0, vitest_1.it)("returns correct parallel flag", () => {
        const analytics = registry_1.registry.getDescriptor("get_analytics");
        (0, vitest_1.expect)(analytics?.parallel).toBe(true);
        const refund = registry_1.registry.getDescriptor("refund_payment");
        (0, vitest_1.expect)(refund?.parallel).toBe(false);
        (0, vitest_1.expect)(refund?.requiresApproval).toBe(true);
    });
});
//# sourceMappingURL=registry.test.js.map