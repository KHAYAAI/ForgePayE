import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "list_stablecoin_payments",
    description: "List recent stablecoin (USDC/USDT) payments.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max results (default 20, max 100)",
        },
      },
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["crypto"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    return { stub: true, tool: "list_stablecoin_payments", input };
  },
});

registry.register({
  definition: {
    name: "list_crypto_payments",
    description: "List recent cryptocurrency payments.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max results (default 20, max 100)",
        },
      },
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["crypto"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    return { stub: true, tool: "list_crypto_payments", input };
  },
});

registry.register({
  definition: {
    name: "list_plans",
    description: "List all available billing plans and their pricing.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["analytics"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    return { stub: true, tool: "list_plans", input };
  },
});
