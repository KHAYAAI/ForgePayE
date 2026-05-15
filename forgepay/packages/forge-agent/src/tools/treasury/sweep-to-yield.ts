import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const TREASURY_URL = process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";

registry.register({
  definition: {
    name: "sweep_to_yield",
    description:
      "⚠️ REQUIRES APPROVAL. Trigger a sweep of idle cash into a yield vault (Aave, Compound, or Ondo USDY). Executes a treasury rule evaluation cycle.",
    input_schema: {
      type: "object",
      properties: {
        subsidiary: { type: "string", description: "Subsidiary to sweep from (e.g. 'HQ', 'EMEA'). Omit for all." },
        amount_usd:   { type: "number", description: "Amount in USD to sweep into the yield vault." },
        target_vault: { type: "string", enum: ["aave", "compound", "ondo"], description: "aave = Aave V3, compound = Compound V3, ondo = Ondo USDY tokenized T-bills." },
      },
      required: ["amount_usd", "target_vault"],
    },
  },
  parallel: false,
  requiresApproval: true,
  toolsets: ["treasury"],
  execute: async (input: Record<string, unknown>, _ctx: ToolContext): Promise<unknown> => {
    const { subsidiary, amount_usd, target_vault } = input as { subsidiary?: string; amount_usd: number; target_vault: string };
    try {
      const res = await fetch(`${TREASURY_URL}/v1/rules/evaluate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      return {
        triggered: true,
        subsidiary: subsidiary ?? "all",
        amountUsd: amount_usd,
        targetVault: target_vault,
        evaluationResults: await res.json(),
        note: "Sweep evaluation triggered. Check execution-log for status.",
      };
    } catch (err) {
      return { error: "SweepFailed", message: String(err) };
    }
  },
});
