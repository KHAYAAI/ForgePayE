import type { ToolsetName, AgentMode } from "./types";

export const MODE_TOOLSETS: Record<AgentMode, ToolsetName[]> = {
  integrate: ["integration", "memory"],
  insight:   ["analytics", "payments", "customers", "subscriptions", "crypto", "webhooks", "memory"],
  act:       ["analytics", "payments", "customers", "subscriptions", "crypto", "webhooks", "billing", "memory", "delegation"],
};

export class ToolsetComposer {
  // Returns de-duplicated toolset list for a mode, with optional billing gate and extra skill toolsets
  static compose(
    mode: AgentMode,
    billingEnabled: boolean,
    extraToolsets: ToolsetName[] = []
  ): ToolsetName[] {
    let base = [...MODE_TOOLSETS[mode]];
    if (!billingEnabled) base = base.filter(t => t !== "billing");
    const all = [...base, ...extraToolsets];
    // deduplicate preserving order
    return Array.from(new Set(all)) as ToolsetName[];
  }
}
