import axios from "axios";
import { registry } from "../../core/registry";
import type { ToolContext } from "../../core/types";

const ENTERPRISE_TREASURY_URL =
  process.env["ENTERPRISE_TREASURY_URL"] ?? "http://localhost:3012";

registry.register({
  definition: {
    name: "get_netting_summary",
    description:
      "Calculate the intercompany netting summary for all pending subsidiary payment flows. Returns gross vs net settlement amounts, fees saved by netting bilateral flows, reduction percentage, and the net payment obligation for each subsidiary pair. Use this to understand how much can be saved by netting before executing settlement.",
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
      const resp = await axios.get(`${ENTERPRISE_TREASURY_URL}/v1/netting/calculate`, {
        timeout: 10_000,
      });

      const { data, summary, total } = resp.data as {
        data: unknown[];
        summary: {
          totalGrossUsd:     number;
          totalNetUsd:       number;
          totalFeesSavedUsd: number;
          reductionPercent:  number;
          pairsCount:        number;
          flowsCount:        number;
        };
        total: number;
      };

      return {
        summary: {
          ...summary,
          // Format for readability in agent responses
          totalGrossFormatted:    `$${summary.totalGrossUsd.toLocaleString()}`,
          totalNetFormatted:      `$${summary.totalNetUsd.toLocaleString()}`,
          feesSavedFormatted:     `$${summary.totalFeesSavedUsd.toLocaleString()}`,
          reductionDescription:   `${summary.reductionPercent}% reduction from gross to net`,
        },
        settlementPairs: data,
        pairCount:       total,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        error:   "EnterpriseTreasuryUnavailable",
        message: `Could not fetch netting calculation: ${message}`,
      };
    }
  },
});
