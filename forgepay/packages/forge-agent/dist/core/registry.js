"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registry = void 0;
class ToolRegistry {
    constructor() {
        this.tools = new Map();
    }
    static getInstance() {
        if (!ToolRegistry._instance)
            ToolRegistry._instance = new ToolRegistry();
        return ToolRegistry._instance;
    }
    register(descriptor) {
        // idempotent re-registration
        if (this.tools.has(descriptor.definition.name))
            return;
        this.tools.set(descriptor.definition.name, descriptor);
    }
    getDefinitions(toolsets) {
        return this.getDescriptors(toolsets).map(d => d.definition);
    }
    getDescriptors(toolsets) {
        const requested = new Set(toolsets);
        return Array.from(this.tools.values()).filter(descriptor => {
            // Include if any of the descriptor's toolsets intersect with the requested set
            return descriptor.toolsets.some(t => requested.has(t));
        });
    }
    getDescriptor(name) {
        return this.tools.get(name);
    }
    listNames() {
        return Array.from(this.tools.keys());
    }
}
exports.registry = ToolRegistry.getInstance();
//# sourceMappingURL=registry.js.map