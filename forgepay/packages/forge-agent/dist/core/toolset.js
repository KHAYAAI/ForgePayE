"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolsetComposer = exports.MODE_TOOLSETS = void 0;
exports.MODE_TOOLSETS = {
    integrate: ["integration", "memory"],
    insight: ["analytics", "payments", "customers", "subscriptions", "crypto", "webhooks", "memory", "rwa"],
    act: ["analytics", "payments", "customers", "subscriptions", "crypto", "webhooks", "billing", "memory", "delegation", "treasury", "agents", "rwa"],
};
class ToolsetComposer {
    // Returns de-duplicated toolset list for a mode, with optional billing gate and extra skill toolsets
    static compose(mode, billingEnabled, extraToolsets = []) {
        let base = [...exports.MODE_TOOLSETS[mode]];
        if (!billingEnabled)
            base = base.filter(t => t !== "billing");
        const all = [...base, ...extraToolsets];
        // deduplicate preserving order
        return Array.from(new Set(all));
    }
}
exports.ToolsetComposer = ToolsetComposer;
//# sourceMappingURL=toolset.js.map