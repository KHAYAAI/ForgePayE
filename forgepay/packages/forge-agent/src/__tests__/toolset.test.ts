import { describe, it, expect } from "vitest";
import { ToolsetComposer } from "../core/toolset";

describe("ToolsetComposer", () => {
  it("integrate mode includes integration and memory", () => {
    const result = ToolsetComposer.compose("integrate", false);
    expect(result).toContain("integration");
    expect(result).toContain("memory");
    expect(result).not.toContain("payments");
  });

  it("insight mode does not include billing by default", () => {
    const result = ToolsetComposer.compose("insight", false);
    expect(result).not.toContain("billing");
  });

  it("act mode includes billing when enabled", () => {
    const result = ToolsetComposer.compose("act", true);
    expect(result).toContain("billing");
    expect(result).toContain("delegation");
  });

  it("act mode excludes billing when disabled", () => {
    const result = ToolsetComposer.compose("act", false);
    expect(result).not.toContain("billing");
  });

  it("extra toolsets are appended and deduplicated", () => {
    const result = ToolsetComposer.compose("insight", false, ["analytics", "payments"] as any);
    const analyticsCount = result.filter(t => t === "analytics").length;
    expect(analyticsCount).toBe(1);
  });
});
