import { registry } from "../../core/registry";

const RWA_URL = process.env["RWA_REGISTRY_URL"] ?? "http://localhost:3008";

registry.register({
  definition: {
    name: "get_rwa_income",
    description:
      "Get income distribution history and tax liability summary for RWA positions. Shows interest, dividends, and coupons earned, with tax treatment breakdown (ordinary_income, qualified_dividend, capital_gain).",
    input_schema: {
      type: "object",
      properties: {
        assetId: { type: "string", description: "Optional: filter to a specific RWA asset (e.g. 'ondo-usdy')" },
        year:    { type: "number", description: "Tax year for liability summary (defaults to current year)" },
      },
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["rwa"],
  execute: async (input: Record<string, unknown>, ctx): Promise<unknown> => {
    try {
      const [incomeRes, taxRes] = await Promise.all([
        fetch(`${RWA_URL}/v1/income?merchantId=${ctx.merchantId}${input["assetId"] ? `&assetId=${input["assetId"]}` : ""}`),
        fetch(`${RWA_URL}/v1/income/tax-summary?merchantId=${ctx.merchantId}${input["year"] ? `&year=${input["year"]}` : ""}`),
      ]);
      return {
        incomeHistory: await incomeRes.json(),
        taxSummary: await taxRes.json(),
      };
    } catch (err) {
      return { error: "RWARegistryUnavailable", message: String(err) };
    }
  },
});
