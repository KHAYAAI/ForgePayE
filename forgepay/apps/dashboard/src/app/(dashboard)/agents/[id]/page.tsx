'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Zap,
} from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Agent {
  agentId: string;
  name?: string;
  did?: string;
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

interface CreditLine {
  credit_limit_usd: number;
  used_usd: number;
  available_usd?: number;
  net_days: number;
  interest_rate_bps?: number;
  default_risk_score: number;
  status?: string;
  terms?: string;
}

interface Decision {
  id: string;
  action_type: string;
  amount_usd: number;
  decision: 'approve' | 'reject' | 'review';
  timestamp: string;
  reason?: string;
}

const TRUST_COLOR: Record<string, string> = {
  unverified: 'bg-red-500/10 text-red-400 border-red-500/20',
  verified:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  trusted:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  premium:    'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
};

const STATUS_COLOR: Record<string, string> = {
  active:    'bg-green-500/10 text-green-400 border-green-500/20',
  suspended: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  blocked:   'bg-red-500/10 text-red-400 border-red-500/20',
};

function ReputationBar({ score }: { score: number }) {
  const pct = Math.min(100, (score / 1000) * 100);
  const color =
    score >= 750 ? 'bg-cyan-400' :
    score >= 500 ? 'bg-blue-400' :
    score >= 250 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">Reputation Score</span>
        <span className="text-xs font-bold text-white">{score} / 1000</span>
      </div>
      <div className="w-full bg-white/5 rounded-full h-2">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CreditBar({ used, limit }: { used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const color =
    pct > 80 ? 'bg-red-500' :
    pct > 50 ? 'bg-yellow-500' : 'bg-cyan-500';

  return (
    <div className="w-full bg-white/5 rounded-full h-2 mt-1">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function fmt(cents: number) {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();

  const { data: agent, isLoading: loadingAgent } =
    useSWR<Agent>(`/api/agents/${id}`, fetcher);

  const { data: creditLine } =
    useSWR<CreditLine>(`/api/agents/${id}/credit-line`, fetcher);

  const { data: decisionsData } =
    useSWR<{ data: Decision[] }>(`/api/agents/${id}/decisions?limit=20`, fetcher);

  const decisions: Decision[] = decisionsData?.data ?? [];

  if (loadingAgent) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-cyan-400" size={28} />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="space-y-4">
        <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Back to Agents
        </Link>
        <div className="card p-6 text-center">
          <AlertCircle className="mx-auto mb-3 text-red-400" size={32} />
          <p className="text-white font-semibold">Agent not found</p>
          <p className="text-sm text-gray-400 mt-1">This agent does not exist or cannot be loaded.</p>
        </div>
      </div>
    );
  }

  const did = agent.did ?? agent.agentId;
  const available = creditLine
    ? (creditLine.available_usd ?? creditLine.credit_limit_usd - creditLine.used_usd)
    : 0;

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back link */}
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={14} /> Back to Agents
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div className="space-y-2 flex-1">
          <p className="text-xs text-gray-500 uppercase tracking-wider">Agent DID</p>
          <code className="font-mono text-sm text-gray-200 break-all">
            {did.length > 60 ? `${did.slice(0, 60)}…` : did}
          </code>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                TRUST_COLOR[agent.trustLevel] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
              }`}
            >
              <CheckCircle2 size={12} />
              {agent.trustLevel}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-semibold ${
                STATUS_COLOR[agent.status] ?? 'bg-gray-500/10 text-gray-400 border-gray-500/20'
              }`}
            >
              <Zap size={12} />
              {agent.status}
            </span>
            <span className="text-xs text-gray-500 bg-white/[0.06] px-2 py-1 rounded border border-white/10">
              {agent.framework}
            </span>
          </div>
        </div>
        <div className="w-64">
          <ReputationBar score={agent.reputationScore} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {creditLine && (
          <>
            <StatCard label="Credit Limit" value={fmt(creditLine.credit_limit_usd)} />
            <StatCard label="Available Credit" value={fmt(available)} />
          </>
        )}
        <StatCard label="Total Transactions" value={agent.totalTransactions.toLocaleString()} />
        <StatCard label="Reputation Score" value={`${agent.reputationScore} / 1000`} accent />
      </div>

      {/* Credit line card */}
      {creditLine && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Credit Line</h2>
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Used: {fmt(creditLine.used_usd)}</span>
              <span>Limit: {fmt(creditLine.credit_limit_usd)}</span>
            </div>
            <CreditBar used={creditLine.used_usd} limit={creditLine.credit_limit_usd} />
            <p className="text-xs text-gray-500 mt-1">
              Available: {fmt(available)}
            </p>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
            <div>
              <p className="text-xs text-gray-500">Net Terms</p>
              <p className="text-sm font-semibold text-white">{creditLine.net_days} days</p>
            </div>
            {creditLine.interest_rate_bps !== undefined && (
              <div>
                <p className="text-xs text-gray-500">Interest Rate</p>
                <p className="text-sm font-semibold text-white">
                  {(creditLine.interest_rate_bps / 100).toFixed(2)}%
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-500">Default Risk</p>
              <p className={`text-sm font-semibold ${
                creditLine.default_risk_score > 50 ? 'text-red-400' :
                creditLine.default_risk_score > 25 ? 'text-yellow-400' : 'text-green-400'
              }`}>
                {creditLine.default_risk_score.toFixed(0)}%
              </p>
            </div>
            {creditLine.status && (
              <div>
                <p className="text-xs text-gray-500">Status</p>
                <p className="text-sm font-semibold text-white capitalize">{creditLine.status}</p>
              </div>
            )}
          </div>
          {creditLine.terms && (
            <p className="text-xs text-gray-400 border-t border-white/5 pt-3">{creditLine.terms}</p>
          )}
        </div>
      )}

      {/* Recent decisions table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5">
          <h2 className="text-sm font-semibold text-white">Recent Decisions</h2>
        </div>
        {decisions.length === 0 ? (
          <div className="text-center py-10">
            <AlertCircle className="mx-auto mb-2 text-gray-600" size={24} />
            <p className="text-sm text-gray-500">No decisions recorded yet</p>
          </div>
        ) : (
          <table className="w-full fp-table">
            <thead>
              <tr>
                <th>Action Type</th>
                <th>Amount</th>
                <th>Decision</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id}>
                  <td className="text-gray-200 capitalize">{d.action_type.replace(/_/g, ' ')}</td>
                  <td className="font-semibold text-white">{fmt(d.amount_usd)}</td>
                  <td>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${
                      d.decision === 'approve'
                        ? 'bg-green-500/10 text-green-400 border-green-500/20'
                        : d.decision === 'review'
                        ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'
                        : 'bg-red-500/10 text-red-400 border-red-500/20'
                    }`}>
                      {d.decision}
                    </span>
                  </td>
                  <td className="text-gray-400 text-xs">
                    {new Date(d.timestamp).toLocaleString('en-US', {
                      month: 'short', day: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-xl font-bold mt-1 ${accent ? 'text-cyan-400' : 'text-white'}`}>{value}</p>
    </div>
  );
}
