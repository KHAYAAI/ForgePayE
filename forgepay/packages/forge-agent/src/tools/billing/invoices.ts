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
    name: "get_invoice",
    description: "Retrieve a single invoice by ID from F.Billing (Kill Bill).",
    input_schema: {
      type: "object",
      properties: {
        invoice_id: {
          type: "string",
          description: "Invoice ID (UUID format)",
        },
      },
      required: ["invoice_id"],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["billing"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.killBillUrl) return { error: "Kill Bill not configured" };
    const res = await fetch(
      `${ctx.killBillUrl}/1.0/kb/invoices/${input.invoice_id}`,
      { headers: KB_HEADERS(ctx.killBillAuth ?? "") }
    );
    return res.json();
  },
});

registry.register({
  definition: {
    name: "list_account_invoices",
    description:
      "List all invoices for a customer account from F.Billing (Kill Bill).",
    input_schema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Kill Bill account ID (UUID format)",
        },
        unpaid_only: {
          type: "boolean",
          description: "If true, return only unpaid invoices",
        },
      },
      required: ["account_id"],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["billing"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.killBillUrl) return { error: "Kill Bill not configured" };
    const params = input.unpaid_only ? "?unpaidInvoicesOnly=true" : "";
    const res = await fetch(
      `${ctx.killBillUrl}/1.0/kb/accounts/${input.account_id}/invoices${params}`,
      { headers: KB_HEADERS(ctx.killBillAuth ?? "") }
    );
    return res.json();
  },
});

registry.register({
  definition: {
    name: "get_account_overdue",
    description:
      "Check the overdue/dunning status for a customer account in F.Billing.",
    input_schema: {
      type: "object",
      properties: {
        account_id: {
          type: "string",
          description: "Kill Bill account ID (UUID format)",
        },
      },
      required: ["account_id"],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["billing"],
  execute: async (input, ctx: ToolContext): Promise<unknown> => {
    if (!ctx.killBillUrl) return { error: "Kill Bill not configured" };
    const res = await fetch(
      `${ctx.killBillUrl}/1.0/kb/accounts/${input.account_id}/overdue`,
      { headers: KB_HEADERS(ctx.killBillAuth ?? "") }
    );
    return res.json();
  },
});
