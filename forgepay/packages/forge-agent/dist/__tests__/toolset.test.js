"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const toolset_1 = require("../core/toolset");
(0, vitest_1.describe)("ToolsetComposer", () => {
    (0, vitest_1.it)("integrate mode includes integration and memory", () => {
        const result = toolset_1.ToolsetComposer.compose("integrate", false);
        (0, vitest_1.expect)(result).toContain("integration");
        (0, vitest_1.expect)(result).toContain("memory");
        (0, vitest_1.expect)(result).not.toContain("payments");
    });
    (0, vitest_1.it)("insight mode does not include billing by default", () => {
        const result = toolset_1.ToolsetComposer.compose("insight", false);
        (0, vitest_1.expect)(result).not.toContain("billing");
    });
    (0, vitest_1.it)("act mode includes billing when enabled", () => {
        const result = toolset_1.ToolsetComposer.compose("act", true);
        (0, vitest_1.expect)(result).toContain("billing");
        (0, vitest_1.expect)(result).toContain("delegation");
    });
    (0, vitest_1.it)("act mode excludes billing when disabled", () => {
        const result = toolset_1.ToolsetComposer.compose("act", false);
        (0, vitest_1.expect)(result).not.toContain("billing");
    });
    (0, vitest_1.it)("extra toolsets are appended and deduplicated", () => {
        const result = toolset_1.ToolsetComposer.compose("insight", false, ["analytics", "payments"]);
        const analyticsCount = result.filter(t => t === "analytics").length;
        (0, vitest_1.expect)(analyticsCount).toBe(1);
    });
});
//# sourceMappingURL=toolset.test.js.map