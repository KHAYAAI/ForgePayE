import Anthropic from "@anthropic-ai/sdk";
export declare const billingTools: Anthropic.Tool[];
export declare const BILLING_APPROVAL_REQUIRED: Set<string>;
export declare function executeBillingTool(toolName: string, toolInput: Record<string, unknown>, killBillUrl: string, killBillAuth: string): Promise<unknown>;
//# sourceMappingURL=billing.d.ts.map