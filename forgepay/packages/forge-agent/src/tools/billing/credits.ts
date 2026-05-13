import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const KB_HEADERS = (auth: string): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Basic ${auth}`,
  "X-Killbill-ApiKey": "forgepay",
  "X-Killbill-ApiSecret": "forgepay",
  "X-Killbill-CreatedBy": "forge-agent",
});

registry.register({
  definition: {
    name: "retry_failed_payment",
    description:
      "⚠️ REQUIRES APPROVAL. Retry a failed payment transaction in F.Billing.",
    input_schema: {
      type: "object",
      properties: {
        transaction_id: {
          type: "string",
          description: "Kill Bill payment transaction ID (UUID format)",
        },
      },
      required: ["transaction_id"],
    },
  },
  parallel: false,
  requiresApproval: true,
  toolsets: ["billing"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.killBillUrl) return { error: "Kill Bill not configured" };
    const res = await fetch(
      `${ctx.killBillUrl}/1.0/kb/paymentTransactions/${input.transaction_id}`,
      {
        method: "POST",
        headers: KB_HEADERS(ctx.killBillAuth ?? ""),
        body: JSON.stringify({}),
      }
    );
    return res.json();
  },
});

registry.register({
  definition: {
    name: "apply_credit",
    description:
      "⚠️ REQUIRES APPROVAL. Apply a credit to a customer account in F.Billing.",
    input_schema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Kill Bill account ID",
        },
        credit_amount: {
          type: "number",
          description: "Credit amount in USD",
        },
        description: {
          type: "string",
          description: "Reason for the credit",
        },
      },
      required: ["account_id", "credit_amount"],
    },
  },
  parallel: false,
  requiresApproval: true,
  toolsets: ["billing"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.killBillUrl) return { error: "Kill Bill not configured" };
    const res = await fetch(`${ctx.killBillUrl}/1.0/kb/credits`, {
      method: "POST",
      headers: KB_HEADERS(ctx.killBillAuth ?? ""),
      body: JSON.stringify({
        accountId:    input.account_id,
        creditAmount: input.credit_amount,
        description:  input.description ?? "Credit applied by Forge Agent",
        currency:     "USD",
      }),
    });
    return res.json();
  },
});
