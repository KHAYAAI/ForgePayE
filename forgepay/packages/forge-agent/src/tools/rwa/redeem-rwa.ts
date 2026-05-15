import { registry } from "../../core/registry";

const RWA_URL = process.env["RWA_REGISTRY_URL"] ?? "http://localhost:3008";

registry.register({
  definition: {
    name: "redeem_rwa",
    description:
      "⚠️ REQUIRES APPROVAL. Submit a redemption request for an RWA position. Funds will be returned to the merchant's USDC wallet based on the asset's redemption speed (instant to T+5).",
    input_schema: {
      type: "object",
      properties: {
        assetId:    { type: "string", description: "RWA asset ID to redeem (e.g. 'ondo-usdy')" },
        positionId: { type: "string", description: "Position ID to redeem from" },
        units:      { type: "number", description: "Number of RWA tokens to redeem" },
      },
      required: ["assetId", "positionId", "units"],
    },
  },
  parallel: false,
  requiresApproval: true,
  toolsets: ["rwa"],
  execute: async (input: Record<string, unknown>, ctx): Promise<unknown> => {
    try {
      const res = await fetch(`${RWA_URL}/v1/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: ctx.merchantId, ...input }),
      });
      return res.json();
    } catch (err) {
      return { error: "RWARegistryUnavailable", message: String(err) };
    }
  },
});
