import { describe, it, expect, beforeEach } from "vitest";

// Test the ToolRegistry singleton
// Since it's a singleton and tools auto-register on import, import the barrel to get registered tools
describe("ToolRegistry", () => {
  it("registers tools and lists them", () => {
    // Import the toolsets barrel to trigger registration
    require("../tools/toolsets");
    const { registry } = require("../core/registry");
    const names = registry.listNames();
    expect(names).toContain("get_analytics");
    expect(names).toContain("refund_payment");
    expect(names).toContain("memory_recall");
    expect(names).toContain("delegate_task");
  });

  it("getDefinitions filters by toolset", () => {
    require("../tools/toolsets");
    const { registry } = require("../core/registry");
    const defs = registry.getDefinitions(["analytics"]);
    expect(defs.some((d: { name: string }) => d.name === "get_analytics")).toBe(true);
    expect(defs.some((d: { name: string }) => d.name === "refund_payment")).toBe(false);
  });

  it("returns correct parallel flag", () => {
    require("../tools/toolsets");
    const { registry } = require("../core/registry");
    const analytics = registry.getDescriptor("get_analytics");
    expect(analytics?.parallel).toBe(true);
    const refund = registry.getDescriptor("refund_payment");
    expect(refund?.parallel).toBe(false);
    expect(refund?.requiresApproval).toBe(true);
  });
});
