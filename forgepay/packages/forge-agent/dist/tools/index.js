"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.READ_ONLY_TOOLS = exports.APPROVAL_REQUIRED = exports.coreTools = void 0;
// ── Core tools (15) — always active when FORGE_AGENT_ENABLED=true ──────────
exports.coreTools = [
    {
        name: "get_analytics",
        description: "Retrieve revenue, payment volume, and churn metrics for a date range.",
        input_schema: {
            type: "object",
            properties: {
                start_date: {
                    type: "string",
                    description: "ISO 8601 date string (e.g. 2026-01-01)",
                },
                end_date: {
                    type: "string",
                    description: "ISO 8601 date string (e.g. 2026-01-31)",
                },
            },
            required: ["start_date", "end_date"],
        },
    },
    {
        name: "list_payments",
        description: "List recent payments, optionally filtered by status or customer.",
        input_schema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max results (default 20, max 100)" },
                status: { type: "string", description: "Filter by status: succeeded | failed | pending | refunded" },
                customer_id: { type: "string", description: "Filter by customer ID" },
            },
        },
    },
    {
        name: "refund_payment",
        description: "⚠️ REQUIRES APPROVAL. Issue a full or partial refund for a payment.",
        input_schema: {
            type: "object",
            properties: {
                payment_id: { type: "string", description: "Payment ID to refund (e.g. pay_xxx)" },
                amount: { type: "number", description: "Amount to refund in USD cents. Omit for full refund." },
                reason: { type: "string", description: "Reason for refund: duplicate | fraudulent | customer_request" },
            },
            required: ["payment_id"],
        },
    },
    {
        name: "list_customers",
        description: "List customers, optionally filtered by email.",
        input_schema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max results (default 20, max 100)" },
                email: { type: "string", description: "Filter by email address" },
            },
        },
    },
    {
        name: "get_customer",
        description: "Retrieve a single customer by ID.",
        input_schema: {
            type: "object",
            properties: {
                customer_id: { type: "string", description: "Customer ID (e.g. cust_xxx)" },
            },
            required: ["customer_id"],
        },
    },
    {
        name: "list_subscriptions",
        description: "List subscriptions, optionally filtered by status.",
        input_schema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max results (default 20, max 100)" },
                status: { type: "string", description: "Filter by status: active | cancelled | paused | past_due" },
            },
        },
    },
    {
        name: "cancel_subscription",
        description: "⚠️ REQUIRES APPROVAL. Cancel an active subscription.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: { type: "string", description: "Subscription ID to cancel" },
            },
            required: ["subscription_id"],
        },
    },
    {
        name: "pause_subscription",
        description: "⚠️ REQUIRES APPROVAL. Pause an active subscription.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: { type: "string", description: "Subscription ID to pause" },
            },
            required: ["subscription_id"],
        },
    },
    {
        name: "resume_subscription",
        description: "⚠️ REQUIRES APPROVAL. Resume a paused subscription.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: { type: "string", description: "Subscription ID to resume" },
            },
            required: ["subscription_id"],
        },
    },
    {
        name: "upgrade_subscription",
        description: "⚠️ REQUIRES APPROVAL. Change a subscription to a different plan.",
        input_schema: {
            type: "object",
            properties: {
                subscription_id: { type: "string", description: "Subscription ID to modify" },
                plan_id: { type: "string", description: "Target plan ID to switch to" },
            },
            required: ["subscription_id", "plan_id"],
        },
    },
    {
        name: "list_plans",
        description: "List all available billing plans and their pricing.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "get_webhook_status",
        description: "List configured webhooks and their recent delivery status.",
        input_schema: {
            type: "object",
            properties: {},
        },
    },
    {
        name: "list_stablecoin_payments",
        description: "List recent stablecoin (USDC/USDT) payments.",
        input_schema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max results (default 20, max 100)" },
            },
        },
    },
    {
        name: "list_crypto_payments",
        description: "List recent cryptocurrency payments.",
        input_schema: {
            type: "object",
            properties: {
                limit: { type: "number", description: "Max results (default 20, max 100)" },
            },
        },
    },
    {
        name: "get_integration_code",
        description: "Return copy-pasteable SDK code snippets for integrating ForgePay. Use in Integrate mode.",
        input_schema: {
            type: "object",
            properties: {
                language: {
                    type: "string",
                    description: "Programming language: typescript | python | go | ruby | php",
                },
                feature: {
                    type: "string",
                    description: "Feature to show: checkout | subscriptions | webhooks | stablecoins | crypto",
                },
            },
            required: ["language", "feature"],
        },
    },
];
// Tools that require user approval before execution
exports.APPROVAL_REQUIRED = new Set([
    "refund_payment",
    "cancel_subscription",
    "pause_subscription",
    "resume_subscription",
    "upgrade_subscription",
]);
// Read-only tools safe for Insight mode
exports.READ_ONLY_TOOLS = new Set([
    "get_analytics",
    "list_payments",
    "list_customers",
    "get_customer",
    "list_subscriptions",
    "list_plans",
    "get_webhook_status",
    "list_stablecoin_payments",
    "list_crypto_payments",
]);
//# sourceMappingURL=index.js.map