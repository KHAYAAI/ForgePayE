'use client';

import useSWR from 'swr';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

interface Jurisdiction {
  region:    string;
  type:      string;
  rate:      string;
  collected: number;
  remitted:  number;
}

interface TaxSummary {
  total_tax_cents:     number;
  jurisdiction_count:  number;
  gross_revenue_cents: number;
  effective_tax_rate:  number;
  jurisdictions:       Jurisdiction[];
}

export default function TaxPage() {
  const { data, isLoading } = useSWR<TaxSummary>('/api/tax?days=30', fetcher);

  const totalTax  = data?.total_tax_cents ?? 0;
  const jCount    = data?.jurisdiction_count ?? 0;
  const effRate   = data ? `${(data.effective_tax_rate * 100).toFixed(1)}%` : '—';
  const juris     = data?.jurisdictions?.filter(j => j.collected > 0) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Tax &amp; Compliance</h1>
        <p className="text-sm text-gray-400">ForgePay acts as Merchant of Record — tax is collected and remitted on your behalf.</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-5">
          <div className="text-xs text-gray-400 mb-1">Tax Collected (30d)</div>
          <div className="text-2xl font-bold text-white">{isLoading ? '—' : fmt(totalTax)}</div>
          <div className="text-xs text-emerald-400 mt-1">{isLoading ? '…' : `Across ${jCount} jurisdictions`}</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-gray-400 mb-1">Tax Remitted (30d)</div>
          <div className="text-2xl font-bold text-white">{isLoading ? '—' : fmt(totalTax)}</div>
          <div className="text-xs text-emerald-400 mt-1">Auto-remitted by ForgePay</div>
        </div>
        <div className="card p-5">
          <div className="text-xs text-gray-400 mb-1">Effective Tax Rate</div>
          <div className="text-2xl font-bold text-white">{isLoading ? '—' : effRate}</div>
          <div className="text-xs text-gray-400 mt-1">Blended across jurisdictions</div>
        </div>
      </div>

      {/* MoR explanation */}
      <div className="card p-5 border border-cyan-500/10 bg-cyan-500/5">
        <h3 className="text-sm font-semibold text-cyan-300 mb-2">How MoR Tax Works</h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          As your Merchant of Record, ForgePay registers for VAT/GST in each jurisdiction where your customers are located.
          Tax is calculated at checkout, collected from buyers, and remitted to the relevant tax authority.
          You never need to register for VAT or file tax returns — ForgePay handles it entirely.
        </p>
      </div>

      {/* Breakdown by jurisdiction */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <h3 className="text-sm font-semibold text-white">Tax by Jurisdiction (last 30 days)</h3>
        </div>
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Region</th>
              <th>Tax Type</th>
              <th>Rate</th>
              <th>Collected</th>
              <th>Remitted</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 6 }, (_, i) => <TableRowSkeleton key={i} cols={6} />)
            ) : juris.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-gray-500 py-8 text-sm">
                  No tax data yet — process your first payment to see jurisdiction breakdown.
                </td>
              </tr>
            ) : (
              juris.map((j) => (
                <tr key={j.region}>
                  <td className="font-medium">{j.region}</td>
                  <td className="text-gray-400">{j.type}</td>
                  <td className="text-gray-400">{j.rate}</td>
                  <td className="tabular-nums">{fmt(j.collected)}</td>
                  <td className="tabular-nums">{fmt(j.remitted)}</td>
                  <td>
                    <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
                      Remitted
                    </span>
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
