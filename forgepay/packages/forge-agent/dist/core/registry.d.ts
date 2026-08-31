import type { ToolDescriptor, ToolsetName } from "./types";
import type Anthropic from "@anthropic-ai/sdk";
declare class ToolRegistry {
    private static _instance;
    private tools;
    static getInstance(): ToolRegistry;
    register(descriptor: ToolDescriptor): void;
    getDefinitions(toolsets: ToolsetName[]): Anthropic.Tool[];
    getDescriptors(toolsets: ToolsetName[]): ToolDescriptor[];
    getDescriptor(name: string): ToolDescriptor | undefined;
    listNames(): string[];
}
export declare const registry: ToolRegistry;
export {};
//# sourceMappingURL=registry.d.ts.map