import { registry } from "../../core/registry";

const NEGOTIATION_URL = process.env["AGENT_NEGOTIATION_URL"] ?? "http://localhost:3011";

registry.register({
  definition: {
    name: "check_negotiation",
    description:
      "Get the status and agreed terms of a negotiation session. Use after start_negotiation to see if the other agent has responded.",
    input_schema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "Negotiation session ID returned by start_negotiation" },
      },
      required: ["sessionId"],
    },
  },
  parallel: true,
  requiresApproval: false,
  toolsets: ["agents"],
  execute: async (input: Record<string, unknown>): Promise<unknown> => {
    try {
      const res = await fetch(`${NEGOTIATION_URL}/v1/sessions/${input["sessionId"]}`);
      return res.json();
    } catch (err) {
      return { error: "AgentNegotiationUnavailable", message: String(err) };
    }
  },
});
