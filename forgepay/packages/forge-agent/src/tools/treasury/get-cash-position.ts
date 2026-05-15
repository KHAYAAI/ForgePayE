import axios from "axios";
import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const ENTERPRISE_TREASURY_URL =
  process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";

registry.register({
  definition: {
    name: "get_cash_position",
    description:
      "Retrieve the consolidated enterprise cash position across all connected bank accounts and subsidiaries. Returns total USD balance, breakdown by subsidiary and currency, idle vs deployed cash, and opportunity cost of uninvested funds.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["treasury"],
  execute: async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<unknown> => {
    try {
      const resp = await axios.get(`${ENTERPRISE_TREASURY_URL}/v1/cash-position`, {
        timeout: 10_000,
      });
      return resp.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error:   "Enterprisetreasury Unavailable",
        message: `Could not reach enterprise-treasury service: ${message}`,
        url:     `${ENTERPRISE_TREASURY_URL}/v1/cash-position`,
      };
    }
  },
});
