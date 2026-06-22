'use client';

import useSWR from 'swr';
import {
  LineChart,
  CreditCard,
  AlertTriangle,
  CheckCircle,
  Clock,
  TrendingDown,
  RefreshCw,
} from 'lucide-react';
import { StatCardSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(usd: number) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

function DrawStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    outstanding: 'text-cyan-400 bg-cyan-500/10',
    overdue:     'text-amber-400 bg-amber-500/10',
    defaulted:   'text-red-400 bg-red-500/10',
    repaid:      'text-emerald-400 bg-emerald-500/10',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? 'text-gray-400 bg-white/5'}`}>
      {status}
    </span>
  );
}

function LineStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active:    'text-emerald-400 bg-emerald-500/10',
    suspended: 'text-amber-400 bg-amber-500/10',
    closed:    'text-gray-400 bg-white/5',
  };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${map[status] ?? 'text-gray-400 bg-white/5'}`}>
      {status}
    </span>
  );
}

function StatBox({ label, value, sub, icon: Icon, variant = 'default' }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType;
  variant?: 'default' | 'danger' | 'accent' | 'warning';
}) {
  const colors = {
    default: 'bg-white/5 text-gray-400',
    accent:  'bg-cyan-500/15 border border-cyan-500/20 text-cyan-400',
    danger:  'bg-red-500/10 border border-red-500/20 text-red-400',
    warning: 'bg-amber-500/10 border border-amber-500/20 text-amber-400',
  };
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${colors[variant]}`}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-[11px] text-gray-400 mb-0.5">{label}</div>
        <div className="text-base font-bold text-white leading-none">{value}</div>
        {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function CreditBureauPage() {
  const { data, isLoading }      = useSWR('/api/credit-lines', fetcher);
  const { data: drawsData, isLoading: loadingDraws } = useSWR('/api/credit-lines/draws?limit=50', fetcher);

  const summary  = data?.summary;
  const lines    = data?.lines ?? [];
  const draws    = drawsData?.data ?? [];

  const totals   = summary?.totals;
  const lineStats = summary?.creditLines;
  const drawStats = summary?.draws;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Agent Credit Bureau</h1>
        <p className="text-sm text-gray-400">Revolving credit lines for AI agents · Live</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading ? (
          <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
        ) : (
          <>
            <StatBox label="Total Issued"      value={fmt(totals?.totalIssuedUsd ?? 0)}      icon={LineChart}     variant="accent" />
            <StatBox label="Outstanding"       value={fmt(totals?.totalOutstandingUsd ?? 0)} icon={CreditCard}    sub={`${drawStats?.outstanding ?? 0} draws`} />
            <StatBox label="Overdue"           value={fmt(totals?.totalOverdueUsd ?? 0)}     icon={Clock}         variant={totals?.totalOverdueUsd > 0 ? 'warning' : 'default'} sub={`${drawStats?.overdue ?? 0} draws`} />
            <StatBox label="Total Losses"      value={fmt(totals?.totalLossUsd ?? 0)}        icon={TrendingDown}  variant={totals?.totalLossUsd > 0 ? 'danger' : 'default'} sub={`${((totals?.defaultRate ?? 0) * 100).toFixed(1)}% default rate`} />
          </>
        )}
      </div>

      {/* Credit line status pills */}
      {!isLoading && lineStats && (
        <div className="flex items-center gap-3 flex-wrap">
          {[
            { label: `${lineStats.active} active`,    color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' },
            { label: `${lineStats.suspended} suspended`, color: 'text-amber-400 bg-amber-500/10 border-amber-500/20' },
            { label: `${lineStats.closed} closed`,    color: 'text-gray-400 bg-white/5 border-white/10' },
            { label: `${drawStats?.repaid ?? 0} fully repaid`, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' },
            { label: `${drawStats?.defaulted ?? 0} defaulted`,  color: 'text-red-400 bg-red-500/10 border-red-500/20' },
          ].map(({ label, color }) => (
            <span key={label} className={`text-xs font-semibold px-3 py-1 rounded-full border ${color}`}>{label}</span>
          ))}
        </div>
      )}

      {/* Credit lines table */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Credit Lines</h3>
          {isLoading && <RefreshCw size={12} className="text-gray-500 animate-spin" />}
        </div>
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />)}
          </div>
        ) : lines.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">No credit lines issued</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500 border-b border-white/[0.05]">
                  <th className="text-left pb-2 font-medium">Agent</th>
                  <th className="text-right pb-2 font-medium">Limit</th>
                  <th className="text-right pb-2 font-medium">Available</th>
                  <th className="text-right pb-2 font-medium">Used</th>
                  <th className="text-right pb-2 font-medium">Terms</th>
                  <th className="text-right pb-2 font-medium">Rate</th>
                  <th className="text-right pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {lines.map((line: Record<string, unknown>) => (
                  <tr key={line.id as string} className="text-xs">
                    <td className="py-2.5 text-white font-medium font-mono text-[11px]">
                      {(line.agentId as string).slice(0, 20)}…
                    </td>
                    <td className="py-2.5 text-right text-white">{fmt(line.limitUsd as number)}</td>
                    <td className="py-2.5 text-right text-emerald-400">{fmt(line.availableUsd as number)}</td>
                    <td className="py-2.5 text-right text-gray-300">{fmt(line.usedUsd as number)}</td>
                    <td className="py-2.5 text-right text-gray-400">{line.termsDays as number}d</td>
                    <td className="py-2.5 text-right text-gray-400">{((line.interestRateBps as number) / 100).toFixed(1)}%</td>
                    <td className="py-2.5 text-right"><LineStatusBadge status={line.status as string} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent draws */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Recent Draws</h3>
          {loadingDraws && <RefreshCw size={12} className="text-gray-500 animate-spin" />}
        </div>
        {loadingDraws ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-white/[0.03] animate-pulse" />)}
          </div>
        ) : draws.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-8">No draws on record</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] text-gray-500 border-b border-white/[0.05]">
                  <th className="text-left pb-2 font-medium">Agent</th>
                  <th className="text-right pb-2 font-medium">Amount</th>
                  <th className="text-right pb-2 font-medium">Total Owed</th>
                  <th className="text-right pb-2 font-medium">Repaid</th>
                  <th className="text-left pb-2 font-medium pl-4">Purpose</th>
                  <th className="text-right pb-2 font-medium">Due</th>
                  <th className="text-right pb-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {draws.map((draw: Record<string, unknown>) => {
                  const isOverdue = draw.status === 'overdue';
                  const isDefault = draw.status === 'defaulted';
                  return (
                    <tr key={draw.id as string} className={`text-xs ${isDefault ? 'opacity-60' : ''}`}>
                      <td className="py-2.5 text-white font-mono text-[11px]">
                        {(draw.agentId as string).slice(0, 16)}…
                      </td>
                      <td className="py-2.5 text-right text-white">{fmt(draw.amountUsd as number)}</td>
                      <td className="py-2.5 text-right text-gray-300">{fmt(draw.totalOwedUsd as number)}</td>
                      <td className="py-2.5 text-right text-emerald-400">{fmt(draw.repaidUsd as number)}</td>
                      <td className="py-2.5 pl-4 text-gray-400 max-w-[120px] truncate">{draw.purpose as string}</td>
                      <td className={`py-2.5 text-right ${isOverdue || isDefault ? 'text-red-400' : 'text-gray-400'}`}>
                        {new Date(draw.dueAt as string).toLocaleDateString()}
                      </td>
                      <td className="py-2.5 text-right">
                        <DrawStatusBadge status={draw.status as string} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Defaults alert */}
      {!isLoading && drawStats?.defaulted > 0 && (
        <div className="card p-4 border border-red-500/20 flex items-start gap-3">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <div>
            <div className="text-sm font-semibold text-white">
              {drawStats.defaulted} draw{drawStats.defaulted > 1 ? 's' : ''} in default
            </div>
            <div className="text-xs text-gray-400 mt-0.5">
              Total losses: {fmt(totals?.totalLossUsd ?? 0)} · Default rate: {((totals?.defaultRate ?? 0) * 100).toFixed(1)}%
              · Penalty webhooks dispatched to agent-identity
            </div>
          </div>
          <CheckCircle size={14} className="text-gray-600 shrink-0 mt-0.5 ml-auto" />
        </div>
      )}
    </div>
  );
}
