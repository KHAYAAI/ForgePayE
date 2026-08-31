'use client';

import useSWR from 'swr';
import {
  Vault,
  TrendingUp,
  ArrowRightLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { StatCardSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(usd: number) {
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(2)}M`;
  if (usd >= 1_000)     return `$${(usd / 1_000).toFixed(1)}K`;
  return `$${usd.toFixed(2)}`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; label: string }> = {
    balance_above:      { color: 'text-cyan-400 bg-cyan-500/10',     label: 'Balance Above' },
    balance_below:      { color: 'text-amber-400 bg-amber-500/10',   label: 'Balance Below' },
    runway_below_days:  { color: 'text-red-400 bg-red-500/10',       label: 'Runway Alert' },
    scheduled:          { color: 'text-purple-400 bg-purple-500/10', label: 'Scheduled' },
    yield_earned_above: { color: 'text-emerald-400 bg-emerald-500/10', label: 'Yield Trigger' },
    upcoming_payment:   { color: 'text-blue-400 bg-blue-500/10',     label: 'Upcoming Pmt' },
  };
  const style = map[status] ?? { color: 'text-gray-400 bg-white/5', label: status };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${style.color}`}>
      {style.label}
    </span>
  );
}

function StatBox({ label, value, sub, icon: Icon, accent = false }: {
  label: string; value: string; sub?: string; icon: React.ElementType; accent?: boolean;
}) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accent ? 'bg-cyan-500/15 border border-cyan-500/20' : 'bg-white/5'}`}>
        <Icon size={16} className={accent ? 'text-cyan-400' : 'text-gray-400'} />
      </div>
      <div>
        <div className="text-[11px] text-gray-400 mb-0.5">{label}</div>
        <div className="text-base font-bold text-white leading-none">{value}</div>
        {sub && <div className="text-[10px] text-gray-500 mt-0.5">{sub}</div>}
      </div>
    </div>
  );
}

export default function TreasuryPage() {
  const { data: summary, isLoading: loadingSummary } = useSWR('/api/treasury/summary', fetcher);
  const { data: rules,   isLoading: loadingRules   } = useSWR('/api/treasury/rules', fetcher);
  const { data: netting, isLoading: loadingNetting  } = useSWR('/api/treasury/netting', fetcher);
  const { data: approvals } = useSWR('/api/treasury/approvals', fetcher);

  const cash      = summary?.cashPosition;
  const net       = netting?.summary;
  const rulesList = rules?.data ?? [];
  const approvalsList = approvals?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Enterprise Treasury</h1>
          <p className="text-sm text-gray-400">Multi-account cash management · Live</p>
        </div>
        {approvalsList.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <AlertTriangle size={12} />
            {approvalsList.length} pending approval{approvalsList.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Cash stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {loadingSummary ? (
          <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
        ) : (
          <>
            <StatBox label="Total Cash"        value={fmt(cash?.totalUsd ?? 0)}              icon={Vault}           accent />
            <StatBox label="Idle Cash"         value={fmt(cash?.idleCashUsd ?? 0)}            icon={Clock}           sub="earning 0%" />
            <StatBox label="Deployed in Yield" value={fmt(cash?.deployedInYieldUsd ?? 0)}    icon={TrendingUp}      sub="earning yield" />
            <StatBox label="Opportunity Cost"  value={`${fmt(cash?.opportunityCostPerYear ?? 0)}/yr`} icon={AlertTriangle} sub="if idle deployed at 4%" />
          </>
        )}
      </div>

      {/* Netting summary */}
      <div className="card p-5">
        <div className="flex items-center gap-2 mb-4">
          <ArrowRightLeft size={15} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Intercompany Netting</h3>
          {loadingNetting && <RefreshCw size={12} className="text-gray-500 animate-spin" />}
        </div>
        {net ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Gross Flows',    value: fmt(net.totalGrossUsd ?? 0) },
              { label: 'Net Settlement', value: fmt(net.totalNetUsd ?? 0) },
              { label: 'Fees Saved',     value: fmt(net.totalFeesSavedUsd ?? 0) },
              { label: 'Reduction',      value: `${net.reductionPercent ?? 0}%` },
            ].map(({ label, value }) => (
              <div key={label} className="text-center p-3 rounded-xl bg-white/[0.03] border border-white/[0.06]">
                <div className="text-xs text-gray-400 mb-1">{label}</div>
                <div className="text-lg font-bold text-white">{value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-gray-500 py-4 text-center">No pending intercompany flows</div>
        )}
        <div className="mt-3 text-[11px] text-gray-500">
          {net?.flowsCount ?? 0} pending flows across {net?.pairsCount ?? 0} subsidiary pair{(net?.pairsCount ?? 0) !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Rules */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white">Treasury Rules</h3>
          <span className="text-[11px] text-gray-400">
            {rulesList.filter((r: Record<string, unknown>) => r.enabled).length} of {rulesList.length} enabled
          </span>
        </div>
        {loadingRules ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <div key={i} className="h-12 rounded-lg bg-white/[0.03] animate-pulse" />)}
          </div>
        ) : rulesList.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-6">No rules configured</div>
        ) : (
          <div className="divide-y divide-white/[0.05]">
            {rulesList.map((rule: Record<string, unknown>) => (
              <div key={rule.id as string} className="py-3 flex items-center gap-3">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${rule.enabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{rule.name as string}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <StatusBadge status={(rule.condition as Record<string, unknown>)?.type as string} />
                    {Boolean(rule.approvalRequired) && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded-full">
                        Approval req.
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-[11px] text-gray-400">
                    {(rule.executionCount as number) > 0 ? `${rule.executionCount as number}× triggered` : 'Never triggered'}
                  </div>
                  {Boolean(rule.lastTriggered) && (
                    <div className="text-[10px] text-gray-600 mt-0.5">
                      {new Date(rule.lastTriggered as string).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pending approvals */}
      {approvalsList.length > 0 && (
        <div className="card p-5 border border-amber-500/20">
          <div className="flex items-center gap-2 mb-4">
            <Clock size={15} className="text-amber-400" />
            <h3 className="text-sm font-semibold text-white">Pending CFO Approvals</h3>
          </div>
          <div className="space-y-3">
            {approvalsList.map((a: Record<string, unknown>) => (
              <div key={a.id as string} className="flex items-center gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <AlertTriangle size={14} className="text-amber-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{a.rule_name as string}</div>
                  <div className="text-[11px] text-gray-400 mt-0.5">
                    Requested {new Date(a.requestedAt as string ?? a.requested_at as string).toLocaleString()}
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button className="p-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors">
                    <CheckCircle size={14} className="text-emerald-400" />
                  </button>
                  <button className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-colors">
                    <XCircle size={14} className="text-red-400" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Subsidiary breakdown */}
      {cash?.bySubsidiary && Object.keys(cash.bySubsidiary).length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Cash by Subsidiary</h3>
          <div className="space-y-3">
            {Object.entries(cash.bySubsidiary).map(([key, sub]) => {
              const s = sub as { totalUsd: number; accountCount: number; runwayDays: number };
              const pct = cash.totalUsd > 0 ? (s.totalUsd / cash.totalUsd) * 100 : 0;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-white font-medium">{key}</span>
                    <div className="flex items-center gap-3 text-gray-400">
                      <span>{s.accountCount} acct{s.accountCount !== 1 ? 's' : ''}</span>
                      <span className={s.runwayDays < 30 ? 'text-red-400' : 'text-gray-400'}>
                        {s.runwayDays}d runway
                      </span>
                      <span className="text-white font-medium">{fmt(s.totalUsd)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-cyan-500/60" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
