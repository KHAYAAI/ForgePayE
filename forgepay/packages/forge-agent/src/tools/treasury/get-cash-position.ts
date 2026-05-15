import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const TREASURY_URL = process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";

registry.register({
  definition: {
    name: "get_cash_position",
    description:
      "Retrieve the consolidated enterprise cash position across all connected bank accounts and subsidiaries. Returns total USD balance, breakdown by subsidiary and currency, idle vs deployed cash, and opportunity cost of uninvested funds.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["treasury"],
  execute: async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<unknown> => {
    try {
      const res = await fetch(`${TREASURY_URL}/v1/cash-position`);
      return res.json();
    } catch (err) {
      return { error: "EnterpriseTreasuryUnavailable", message: String(err), url: `${TREASURY_URL}/v1/cash-position` };
    }
  },
});
