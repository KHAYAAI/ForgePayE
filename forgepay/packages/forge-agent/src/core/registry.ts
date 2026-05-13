import type { ToolDescriptor, ToolsetName } from "./types";
import type Anthropic from "@anthropic-ai/sdk";

class ToolRegistry {
  private static _instance: ToolRegistry;
  private tools = new Map<string, ToolDescriptor>();

  static getInstance(): ToolRegistry {
    if (!ToolRegistry._instance) ToolRegistry._instance = new ToolRegistry();
    return ToolRegistry._instance;
  }

  register(descriptor: ToolDescriptor): void {
    // idempotent re-registration
    if (this.tools.has(descriptor.definition.name)) return;
    this.tools.set(descriptor.definition.name, descriptor);
  }

  getDefinitions(toolsets: ToolsetName[]): Anthropic.Tool[] {
    return this.getDescriptors(toolsets).map(d => d.definition);
  }

  getDescriptors(toolsets: ToolsetName[]): ToolDescriptor[] {
    const requested = new Set<ToolsetName>(toolsets);
    return Array.from(this.tools.values()).filter(descriptor => {
      // Include if any of the descriptor's toolsets intersect with the requested set
      return descriptor.toolsets.some(t => requested.has(t));
    });
  }

  getDescriptor(name: string): ToolDescriptor | undefined {
    return this.tools.get(name);
  }

  listNames(): string[] {
    return Array.from(this.tools.keys());
  }
}

export const registry = ToolRegistry.getInstance();
