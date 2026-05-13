import { NextRequest, NextResponse } from "next/server";
import { getServerSession }          from "next-auth";
import { runAgent }                  from "@forgepay/forge-agent";
import type { AgentMessage, AgentMode } from "@forgepay/forge-agent";

const FORGE_AGENT_ENABLED =
  process.env.FORGE_AGENT_ENABLED === "true";

const FORGE_AGENT_BILLING_ENABLED =
  process.env.FORGE_AGENT_BILLING_ENABLED === "true";

const FORGE_AGENT_MEMORY_ENABLED =
  process.env.FORGE_AGENT_MEMORY_ENABLED === "true";

export async function GET() {
  if (!FORGE_AGENT_ENABLED) {
    return NextResponse.json({ enabled: false, message: "Coming soon" });
  }
  return NextResponse.json({ enabled: true });
}

export async function POST(req: NextRequest) {
  if (!FORGE_AGENT_ENABLED) {
    return NextResponse.json(
      { enabled: false, message: "Coming soon" },
      { status: 403 }
    );
  }

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as {
    messages:        AgentMessage[];
    mode:            AgentMode;
    approvals?:      Record<string, boolean>;
    skillNames?:     string[];
  };

  const { messages, mode, approvals = {}, skillNames } = body;

  if (!messages || !Array.isArray(messages) || !mode) {
    return NextResponse.json(
      { error: "messages and mode are required" },
      { status: 400 }
    );
  }

  const merchantApiKey = process.env.FORGEPAY_API_KEY ?? "";
  const merchantId     = (session as { user: { id?: string } }).user?.id ?? "unknown";
  const merchantName   = session.user.name ?? "Merchant";

  const pendingApprovals = new Map<string, boolean>(Object.entries(approvals));

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const generator = runAgent(messages, {
          apiKey:         process.env.ANTHROPIC_API_KEY!,
          merchantId,
          merchantName,
          mode,
          billingEnabled:  FORGE_AGENT_BILLING_ENABLED,
          memoryEnabled:   FORGE_AGENT_MEMORY_ENABLED,
          skillNames,
          killBillUrl:    process.env.KILL_BILL_URL,
          killBillAuth:   process.env.KILL_BILL_AUTH,
          model:          process.env.FORGE_AGENT_MODEL ?? "claude-opus-4-7",
          maxTokens:      parseInt(process.env.FORGE_AGENT_MAX_TOKENS ?? "4096"),
        }, pendingApprovals);

        for await (const event of generator) {
          const data = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(data));
        }
      } catch (err) {
        const errEvent = { type: "error", message: String(err) };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errEvent)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
