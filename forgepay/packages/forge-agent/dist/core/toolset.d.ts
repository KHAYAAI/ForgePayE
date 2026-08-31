import type { ToolsetName, AgentMode } from "./types";
export declare const MODE_TOOLSETS: Record<AgentMode, ToolsetName[]>;
export declare class ToolsetComposer {
    static compose(mode: AgentMode, billingEnabled: boolean, extraToolsets?: ToolsetName[]): ToolsetName[];
}
//# sourceMappingURL=toolset.d.ts.map