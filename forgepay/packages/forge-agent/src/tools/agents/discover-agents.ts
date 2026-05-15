import { registry } from "../../core/registry";

const AGENT_IDENTITY_URL = process.env["AGENT_IDENTITY_URL"] ?? "http://localhost:3010";

registry.register({
  definition: {
    name: "discover_agents",
    description:
      "Discover AI agents in the ForgePay network by capability. Returns agents with reputation scores, trust levels, and contact details for delegation or collaboration.",
    input_schema: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "Required capability: payment, negotiation, treasury, data_analysis, marketplace, yield",
        },
        minReputation: { type: "number", description: "Minimum reputation score 0-1000 (e.g. 700 = trusted)." },
        framework:     { type: "string", description: "Filter by framework: elizaos, swarms, forgepay, langchain, autogen" },
        limit:         { type: "number", description: "Max results to return (default 10)." },
      },
      required: ["capability"],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["agents"],
  execute: async (input: Record<string, unknown>): Promise<unknown> => {
    try {
      const url = new URL(`${AGENT_IDENTITY_URL}/v1/discover`);
      url.searchParams.set("capability", input["capability"] as string);
      if (input["minReputation"]) url.searchParams.set("minReputation", String(input["minReputation"]));
      if (input["framework"])     url.searchParams.set("framework", input["framework"] as string);
      if (input["limit"])         url.searchParams.set("limit", String(input["limit"]));
      const res = await fetch(url.toString());
      return res.json();
    } catch (err) {
      return { error: "AgentIdentityUnavailable", message: String(err) };
    }
  },
});
