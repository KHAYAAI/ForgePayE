import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "get_webhook_status",
    description: "List configured webhooks and their recent delivery status.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["webhooks"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    return { stub: true, tool: "get_webhook_status", input };
  },
});
