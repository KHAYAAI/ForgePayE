import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const TREASURY_URL = process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";

registry.register({
  definition: {
    name: "list_treasury_rules",
    description:
      "List all treasury automation rules (cash sweeps, tax escrow, CFO alerts) including enabled status, trigger conditions, and execution history.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["treasury"],
  execute: async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<unknown> => {
    try {
      const res = await fetch(`${TREASURY_URL}/v1/rules`);
      return res.json();
    } catch (err) {
      return { error: "EnterpriseTreasuryUnavailable", message: String(err) };
    }
  },
});
