import { describe, it, expect } from "vitest";
// Importing the barrel triggers self-registration of all tools
import "../tools/toolsets";
import { registry } from "../core/registry";

// Test the ToolRegistry singleton
describe("ToolRegistry", () => {
  it("registers tools and lists them", () => {
    const names = registry.listNames();
    expect(names).toContain("get_analytics");
    expect(names).toContain("refund_payment");
    expect(names).toContain("memory_recall");
    expect(names).toContain("delegate_task");
  });

  it("getDefinitions filters by toolset", () => {
    const defs = registry.getDefinitions(["analytics"]);
    expect(defs.some(d => d.name === "get_analytics")).toBe(true);
    expect(defs.some(d => d.name === "refund_payment")).toBe(false);
  });

  it("returns correct parallel flag", () => {
    const analytics = registry.getDescriptor("get_analytics");
    expect(analytics?.parallel).toBe(true);
    const refund = registry.getDescriptor("refund_payment");
    expect(refund?.parallel).toBe(false);
    expect(refund?.requiresApproval).toBe(true);
  });
});
