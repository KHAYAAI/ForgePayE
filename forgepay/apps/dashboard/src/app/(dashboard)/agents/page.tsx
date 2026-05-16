'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Plus, Zap, TrendingUp, AlertCircle, CheckCircle2, Search, Filter } from 'lucide-react';
import { Input } from '@/components/ui/Input';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Agent {
  agentId: string;
  name?: string;
  framework: string;
  reputationScore: number;
  trustLevel: 'unverified' | 'verified' | 'trusted' | 'premium';
  successRate: number;
  totalTransactions: number;
  dailyLimitUsd: number;
  usedTodayUsd: number;
  status: 'active' | 'suspended' | 'blocked';
  lastActiveAt: string;
  createdAt: string;
}

export default function AgentsPage() {
  const { data, isLoading } = useSWR('/api/agents', fetcher);
  const agents: Agent[] = data?.data ?? [];

  const [search, setSearch] = useState('');
  const [framework, setFramework] = useState<string>('');
  const [trustFilter, setTrustFilter] = useState<string>('');
  const [showModal, setShowModal] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);

  const filtered = agents.filter((a) => {
    const matchesSearch = a.agentId.toLowerCase().includes(search.toLowerCase()) ||
                          (a.name?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchesFramework = !framework || a.framework === framework;
    const matchesTrust = !trustFilter || a.trustLevel === trustFilter;
    return matchesSearch && matchesFramework && matchesTrust;
  });

  const trustColor = {
    unverified: 'bg-red-500/10 text-red-400 border-red-500/20',
    verified:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    trusted:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
    premium:    'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Autonomous Agents</h1>
          <p className="text-sm text-gray-400 mt-1">
            Monitor AI agents using ForgePay for autonomous payments, credit lines, and negotiations
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-600 text-white font-semibold transition-colors"
        >
          <Plus size={18} />
          Register Agent
        </button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2">Search Agent ID</label>
          <Input
            placeholder="agent-xyz-123..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2">Framework</label>
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500"
          >
            <option value="">All Frameworks</option>
            <option value="elizaos">ElizaOS</option>
            <option value="autogen">AutoGen</option>
            <option value="crewai">CrewAI</option>
            <option value="langchain">LangChain</option>
            <option value="swarms">Swarms</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-400 mb-2">Trust Level</label>
          <select
            value={trustFilter}
            onChange={(e) => setTrustFilter(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500"
          >
            <option value="">All Levels</option>
            <option value="unverified">Unverified</option>
            <option value="verified">Verified</option>
            <option value="trusted">Trusted</option>
            <option value="premium">Premium</option>
          </select>
        </div>
      </div>

      {/* Agent Grid */}
      {isLoading ? (
        <div className="text-center py-12">
          <p className="text-gray-400">Loading agents...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <AlertCircle className="mx-auto mb-3 text-gray-500" size={32} />
          <p className="text-gray-400">No agents found</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((agent) => (
            <div
              key={agent.agentId}
              onClick={() => setSelectedAgent(agent)}
              className="card p-5 cursor-pointer hover:bg-white/[0.08] transition-colors border border-white/10"
            >
              <div className="grid grid-cols-1 md:grid-cols-5 gap-4 items-center">
                {/* Agent ID & Framework */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Agent</p>
                  <p className="font-mono text-sm text-white">{agent.agentId.slice(0, 20)}...</p>
                  <span className="inline-block mt-2 text-[10px] font-semibold px-2 py-1 rounded bg-white/[0.06] border border-white/[0.1] text-gray-300">
                    {agent.framework}
                  </span>
                </div>

                {/* Trust & Reputation */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Trust</p>
                  <div className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg border ${trustColor[agent.trustLevel]}`}>
                    <CheckCircle2 size={14} />
                    <span className="text-xs font-semibold capitalize">{agent.trustLevel}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">Score: {agent.reputationScore}/1000</p>
                </div>

                {/* Activity */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Activity</p>
                  <p className="text-sm font-semibold text-white">{agent.successRate.toFixed(1)}% success</p>
                  <p className="text-xs text-gray-400">{agent.totalTransactions} txns</p>
                </div>

                {/* Daily Limit */}
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Limit</p>
                  <div className="w-full bg-white/5 rounded-full h-2">
                    <div
                      className={`h-full rounded-full ${
                        agent.usedTodayUsd > agent.dailyLimitUsd * 0.8 ? 'bg-red-500' :
                        agent.usedTodayUsd > agent.dailyLimitUsd * 0.5 ? 'bg-yellow-500' : 'bg-cyan-500'
                      }`}
                      style={{ width: `${Math.min(100, (agent.usedTodayUsd / agent.dailyLimitUsd) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">
                    ${(agent.usedTodayUsd / 100).toFixed(0)} / ${(agent.dailyLimitUsd / 100).toFixed(0)}
                  </p>
                </div>

                {/* Status */}
                <div className="flex items-center justify-end">
                  {agent.status === 'active' ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-semibold">
                      <Zap size={14} />
                      Active
                    </span>
                  ) : agent.status === 'suspended' ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs font-semibold">
                      <AlertCircle size={14} />
                      Suspended
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
                      <AlertCircle size={14} />
                      Blocked
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Agent Detail Modal */}
      {selectedAgent && (
        <AgentDetailModal
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}

function AgentDetailModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const { data: creditLine } = useSWR(`/api/agents/${agent.agentId}/credit-line`, fetcher);
  const { data: decisions } = useSWR(`/api/agents/${agent.agentId}/decisions?limit=10`, fetcher);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 md:p-0">
      <div className="card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Agent ID</p>
            <p className="font-mono text-lg text-white">{agent.agentId}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Credit Line Section */}
        {creditLine && (
          <div className="border-t border-white/10 pt-6 mt-6">
            <h3 className="text-sm font-semibold text-white mb-4">Active Credit Line</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500">Credit Limit</p>
                <p className="text-lg font-bold text-cyan-400">${(creditLine.credit_limit_usd / 100).toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Used</p>
                <p className="text-lg font-bold text-white">${(creditLine.used_usd / 100).toFixed(0)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Net Terms</p>
                <p className="text-lg font-bold text-white">{creditLine.net_days} days</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Default Risk</p>
                <p className={`text-lg font-bold ${
                  creditLine.default_risk_score > 50 ? 'text-red-400' :
                  creditLine.default_risk_score > 25 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {creditLine.default_risk_score.toFixed(0)}%
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recent Decisions Section */}
        {decisions?.data?.length > 0 && (
          <div className="border-t border-white/10 pt-6 mt-6">
            <h3 className="text-sm font-semibold text-white mb-4">Recent Decisions</h3>
            <div className="space-y-2">
              {decisions.data.slice(0, 5).map((d: any) => (
                <div key={d.id} className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/5">
                  <div>
                    <p className="text-xs text-gray-400">{d.action_type}</p>
                    <p className="text-sm font-semibold text-white">${(d.amount_usd / 100).toFixed(0)}</p>
                  </div>
                  <span className={`px-2 py-1 rounded text-xs font-semibold ${
                    d.decision === 'approve' ? 'bg-green-500/10 text-green-400' :
                    d.decision === 'review' ? 'bg-yellow-500/10 text-yellow-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {d.decision}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-6 w-full px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-white font-semibold hover:bg-white/10 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
