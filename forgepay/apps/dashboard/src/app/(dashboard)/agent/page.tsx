import AgentChat from "@/components/agent/AgentChat";
import { ComingSoonOverlay } from "@/components/agent/ComingSoonOverlay";

export const metadata = { title: "Forge Agent — ForgePay" };

export default function AgentPage() {
  const agentEnabled = process.env.NEXT_PUBLIC_FORGE_AGENT_ENABLED === 'true';

  if (!agentEnabled) {
    return (
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-white">Forge Agent</h1>
          <p className="text-sm text-gray-400">AI-powered billing assistant</p>
        </div>
        <ComingSoonOverlay />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Forge Agent</h1>
          <p className="mt-1 text-sm text-gray-500">
            AI-powered billing assistant — manage payments, subscriptions, and
            analytics with natural language
          </p>
        </div>
        <span className="rounded-full bg-cyan-500/20 px-3 py-1 text-xs font-semibold text-cyan-400">
          Beta
        </span>
      </div>
      <div className="flex-1 overflow-hidden">
        <AgentChat enabled={true} />
      </div>
    </div>
  );
}
