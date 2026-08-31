"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BILLING_APPROVAL_REQUIRED = exports.billingTools = void 0;
exports.executeBillingTool = executeBillingTool;
// ── F.Billing tools (5) — gated behind FORGE_AGENT_BILLING_ENABLED=true ──────
// Built and ready; not exposed to Claude API until the flag is set.
// These hit Kill Bill's REST API directly at KILL_BILL_URL.
exports.billingTools = [
    {
        name: "get_invoice",
        description: "Retrieve a single invoice by ID from F.Billing (Kill Bill).",
        input_schema: {
            type: "object",
            properties: {
                invoice_id: { type: "string", description: "Invoice ID (UUID format)" },
            },
            required: ["invoice_id"],
        },
    },
    {
        name: "list_account_invoices",
        description: "List all invoices for a customer account from F.Billing (Kill Bill).",
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
    {
        name: "get_account_overdue",
        description: "Check the overdue/dunning status for a customer account in F.Billing.",
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
    {
        name: "retry_failed_payment",
        description: "⚠️ REQUIRES APPROVAL. Retry a failed payment transaction in F.Billing.",
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
    {
        name: "apply_credit",
        description: "⚠️ REQUIRES APPROVAL. Apply a credit to a customer account in F.Billing.",
        input_schema: {
            type: "object",
            properties: {
                account_id: { type: "string", description: "Kill Bill account ID" },
                credit_amount: { type: "number", description: "Credit amount in USD" },
                description: { type: "string", description: "Reason for the credit" },
            },
            required: ["account_id", "credit_amount"],
        },
    },
];
// Billing tools that require approval
exports.BILLING_APPROVAL_REQUIRED = new Set([
    "retry_failed_payment",
    "apply_credit",
]);
// Execute a billing tool by calling Kill Bill REST API
async function executeBillingTool(toolName, toolInput, killBillUrl, killBillAuth) {
    const headers = {
        "Content-Type": "application/json",
        Authorization: `Basic ${killBillAuth}`,
        "X-Killbill-ApiKey": "forgepay",
        "X-Killbill-ApiSecret": "forgepay",
        "X-Killbill-CreatedBy": "forge-agent",
    };
    switch (toolName) {
        case "get_invoice": {
            const res = await fetch(`${killBillUrl}/1.0/kb/invoices/${toolInput.invoice_id}`, { headers });
            return res.json();
        }
        case "list_account_invoices": {
            const params = toolInput.unpaid_only
                ? "?unpaidInvoicesOnly=true"
                : "";
            const res = await fetch(`${killBillUrl}/1.0/kb/accounts/${toolInput.account_id}/invoices${params}`, { headers });
            return res.json();
        }
        case "get_account_overdue": {
            const res = await fetch(`${killBillUrl}/1.0/kb/accounts/${toolInput.account_id}/overdue`, { headers });
            return res.json();
        }
        case "retry_failed_payment": {
            const res = await fetch(`${killBillUrl}/1.0/kb/paymentTransactions/${toolInput.transaction_id}`, { method: "POST", headers, body: JSON.stringify({}) });
            return res.json();
        }
        case "apply_credit": {
            const res = await fetch(`${killBillUrl}/1.0/kb/credits`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                    accountId: toolInput.account_id,
                    creditAmount: toolInput.credit_amount,
                    description: toolInput.description ?? "Credit applied by Forge Agent",
                    currency: "USD",
                }),
            });
            return res.json();
        }
        default:
            throw new Error(`Unknown billing tool: ${toolName}`);
    }
}
//# sourceMappingURL=billing.js.map