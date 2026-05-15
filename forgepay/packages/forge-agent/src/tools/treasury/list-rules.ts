import axios from "axios";
import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const ENTERPRISE_TREASURY_URL =
  process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";

registry.register({
  definition: {
    name: "list_treasury_rules",
    description:
      "List all treasury automation rules configured in the Enterprise Treasury Module. Returns rules for cash sweeps, tax escrow allocation, payroll repatriation, and CFO alerts — including whether they are enabled, their trigger conditions, and execution history.",
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
      const resp = await axios.get(`${ENTERPRISE_TREASURY_URL}/v1/rules`, {
        timeout: 10_000,
      });
      return resp.data;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error:   "EnterpriseTreasuryUnavailable",
        message: `Could not fetch treasury rules: ${message}`,
      };
    }
  },
});
