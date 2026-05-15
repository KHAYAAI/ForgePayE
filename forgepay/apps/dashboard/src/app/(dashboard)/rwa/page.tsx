'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { TrendingUp, DollarSign, Clock, RefreshCw, ArrowDownToLine, Plus } from 'lucide-react';
import { StatCardSkeleton, TableRowSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Position {
  id: string;
  asset: string;
  units: number;
  invested_usd: number;
  current_value_usd: number;
  apy_bps: number;
  accrued_income_usd: number;
  status: string;
}

interface IncomeEntry {
  date: string;
  asset: string;
  amount_usd: number;
  type: string;
  tax_type: string;
}

interface TaxSummary {
  ordinary_income_usd: number;
  qualified_dividend_usd: number;
  capital_gains_usd: number;
}

interface RwaData {
  positions: Position[];
  income_history: IncomeEntry[];
  tax_summary: TaxSummary;
}

function fmt(usd: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(usd);
}

function fmtBps(bps: number) {
  return (bps / 100).toFixed(2) + '%';
}

const TAX_LABELS: Record<string, string> = {
  ordinary_income:    'Ordinary Income',
  qualified_dividend: 'Qualified Dividend',
  capital_gain:       'Capital Gain',
};

export default function RwaPage() {
  const { data, isLoading } = useSWR<RwaData>('/api/rwa', fetcher);

  const positions: Position[]    = data?.positions      ?? [];
  const income: IncomeEntry[]    = data?.income_history ?? [];
  const taxSummary               = data?.tax_summary;

  const totalInvested     = positions.reduce((a, p) => a + p.invested_usd, 0);
  const totalCurrentValue = positions.reduce((a, p) => a + p.current_value_usd, 0);
  const totalAccrued      = positions.reduce((a, p) => a + p.accrued_income_usd, 0);
  const avgApy            = positions.length
    ? positions.reduce((a, p) => a + p.apy_bps, 0) / positions.length
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">RWA Investments</h1>
          <p className="text-sm text-gray-400">Manage your tokenized asset positions</p>
        </div>
        <button className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors">
          <Plus size={13} /> New Position
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <div className="card p-5 flex items-start gap-4">
              <div className="p-2 rounded-lg bg-cyan-500/10 shrink-0">
                <DollarSign size={16} className="text-cyan-400" />
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Total Invested</div>
                <div className="text-xl font-bold text-white">{fmt(totalInvested)}</div>
                <div className="text-[11px] text-emerald-400 mt-0.5">
                  {fmt(totalCurrentValue)} current value
                </div>
              </div>
            </div>

            <div className="card p-5 flex items-start gap-4">
              <div className="p-2 rounded-lg bg-emerald-500/10 shrink-0">
                <TrendingUp size={16} className="text-emerald-400" />
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Accrued Yield (YTD)</div>
                <div className="text-xl font-bold text-white">{fmt(totalAccrued)}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">
                  Ordinary: {fmt(taxSummary?.ordinary_income_usd ?? 0)} · Div: {fmt(taxSummary?.qualified_dividend_usd ?? 0)}
                </div>
              </div>
            </div>

            <div className="card p-5 flex items-start gap-4">
              <div className="p-2 rounded-lg bg-purple-500/10 shrink-0">
                <Clock size={16} className="text-purple-400" />
              </div>
              <div>
                <div className="text-xs text-gray-400 mb-1">Avg APY</div>
                <div className="text-xl font-bold text-white">{fmtBps(avgApy)}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">{positions.length} active position{positions.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Positions table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Positions</h3>
          <RefreshCw size={13} className="text-gray-500 cursor-pointer hover:text-gray-300 transition-colors" />
        </div>
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Asset</th>
              <th>Units</th>
              <th>Invested</th>
              <th>Current Value</th>
              <th>APY</th>
              <th>Accrued Income</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <TableRowSkeleton cols={8} />
                <TableRowSkeleton cols={8} />
              </>
            ) : positions.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center text-gray-500 py-8 text-sm">
                  No positions yet. Click "New Position" to get started.
                </td>
              </tr>
            ) : (
              positions.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium text-white">{p.asset}</td>
                  <td className="text-gray-300 tabular-nums text-xs">
                    {p.units.toLocaleString()}
                  </td>
                  <td className="tabular-nums text-sm">{fmt(p.invested_usd)}</td>
                  <td className="tabular-nums text-sm text-emerald-400">{fmt(p.current_value_usd)}</td>
                  <td className="tabular-nums text-sm text-cyan-400">{fmtBps(p.apy_bps)}</td>
                  <td className="tabular-nums text-sm text-emerald-400">{fmt(p.accrued_income_usd)}</td>
                  <td>
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                      p.status === 'active'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-gray-500/10 text-gray-400 border-gray-500/20'
                    }`}>
                      {p.status}
                    </span>
                  </td>
                  <td>
                    <button className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
                      <ArrowDownToLine size={11} /> Redeem
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Income history table */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <h3 className="text-sm font-semibold text-white">Income History</h3>
        </div>
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Asset</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Tax Impact</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <TableRowSkeleton cols={5} />
                <TableRowSkeleton cols={5} />
              </>
            ) : income.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-gray-500 py-8 text-sm">
                  No income events recorded yet.
                </td>
              </tr>
            ) : (
              income.map((entry, i) => (
                <tr key={i}>
                  <td className="text-gray-400 text-xs tabular-nums">{entry.date}</td>
                  <td className="font-medium text-white">{entry.asset}</td>
                  <td className="tabular-nums text-sm text-emerald-400">{fmt(entry.amount_usd)}</td>
                  <td>
                    <span className={`text-[10px] font-semibold capitalize px-2 py-0.5 rounded-full border ${
                      entry.type === 'interest'
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    }`}>
                      {entry.type}
                    </span>
                  </td>
                  <td className="text-gray-400 text-xs">
                    {TAX_LABELS[entry.tax_type] ?? entry.tax_type}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
