import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

registry.register({
  definition: {
    name: "list_payments",
    description: "List recent payments, optionally filtered by status or customer.",
    input_schema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max results (default 20, max 100)",
        },
        status: {
          type: "string",
          description: "Filter by status: succeeded | failed | pending | refunded",
        },
        customer_id: {
          type: "string",
          description: "Filter by customer ID",
        },
      },
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["payments"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    return { stub: true, tool: "list_payments", input };
  },
});

registry.register({
  definition: {
    name: "refund_payment",
    description:
      "⚠️ REQUIRES APPROVAL. Issue a full or partial refund for a payment.",
    input_schema: {
      type: "object",
      properties: {
        payment_id: {
          type: "string",
          description: "Payment ID to refund (e.g. pay_xxx)",
        },
        amount: {
          type: "number",
          description: "Amount to refund in USD cents. Omit for full refund.",
        },
        reason: {
          type: "string",
          description: "Reason for refund: duplicate | fraudulent | customer_request",
        },
      },
      required: ["payment_id"],
    },
  },
  parallel: false,
  requiresApproval: true,
  toolsets: ["payments"],
  execute: async (input, _ctx: ToolContext): Promise<unknown> => {
    return { stub: true, tool: "refund_payment", input };
  },
});
