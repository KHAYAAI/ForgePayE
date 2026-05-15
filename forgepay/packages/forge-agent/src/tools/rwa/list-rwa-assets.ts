import { registry } from "../../core/registry";

const RWA_URL = process.env["RWA_REGISTRY_URL"] ?? "http://localhost:3008";

registry.register({
  definition: {
    name: "list_rwa_assets",
    description:
      "List available Real-World Asset (RWA) investments: tokenized T-bills (Ondo USDY, OpenEden TBILL, Franklin Templeton FOBXX, BlackRock BUIDL), money markets, and bonds. Returns current APY, minimum investment, redemption speed, and on-chain details.",
    input_schema: {
      type: "object",
      properties: {
        assetClass:       { type: "string", description: "Filter: treasury_bill, money_market, corporate_bond, equity, real_estate" },
        minApyBps:        { type: "number", description: "Minimum APY in basis points (500 = 5%)" },
        redemptionSpeed:  { type: "string", description: "Liquidity filter: instant, same_day, next_day, T+2, T+5" },
        requiresAccredited: { type: "boolean", description: "If false, only return assets open to non-accredited investors" },
      },
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["rwa"],
  execute: async (input: Record<string, unknown>): Promise<unknown> => {
    try {
      const url = new URL(`${RWA_URL}/v1/assets`);
      if (input["assetClass"])      url.searchParams.set("assetClass", input["assetClass"] as string);
      if (input["minApyBps"])       url.searchParams.set("minApy", String(input["minApyBps"]));
      if (input["redemptionSpeed"]) url.searchParams.set("redemptionSpeed", input["redemptionSpeed"] as string);
      if (input["requiresAccredited"] === false) url.searchParams.set("requiresAccredited", "false");
      const res = await fetch(url.toString());
      return res.json();
    } catch (err) {
      return { error: "RWARegistryUnavailable", message: String(err) };
    }
  },
});
