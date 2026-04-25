import AgentChat from "@/components/agent/AgentChat";

export const metadata = { title: "Forge Agent — ForgePay" };

async function getAgentStatus(): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/api/agent/chat`,
      { cache: "no-store" }
    );
    const data = await res.json() as { enabled: boolean };
    return data.enabled ?? false;
  } catch {
    return false;
  }
}

export default async function AgentPage() {
  const enabled = await getAgentStatus();

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A2540]">Forge Agent</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-powered billing assistant — manage payments, subscriptions, and
            analytics with natural language
          </p>
        </div>
        <span className="rounded-full bg-[#00F0FF]/20 px-3 py-1 text-xs font-semibold text-[#0A2540]">
          Beta
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        <AgentChat enabled={enabled} />
      </div>
    </div>
  );
}
