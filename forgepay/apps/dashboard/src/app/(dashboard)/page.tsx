'use client';

import useSWR from 'swr';
import { CreditCard, RefreshCw, Users, DollarSign, ShieldCheck } from 'lucide-react';
import StatCard from '@/components/dashboard/StatCard';
import { StatCardSkeleton } from '@/components/ui/Skeleton';
import RevenueChart from '@/components/dashboard/RevenueChart';
import RecentPayments from '@/components/payments/RecentPayments';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function OverviewPage() {
  const { data: summary } = useSWR('/api/analytics/summary?days=30', fetcher);
  const { data: subs }    = useSWR('/api/subscriptions', fetcher);
  const { data: custs }   = useSWR('/api/customers', fetcher);

  const revenue     = summary ? fmt(summary.gross_revenue_cents ?? 0) : '—';
  const successCnt  = summary ? String(summary.successful_count ?? 0) : '—';
  const successRate = summary ? `${((summary.success_rate ?? 0) * 100).toFixed(1)}% success rate` : '';
  const subCount    = subs    ? String((subs.data ?? []).length)  : '—';
  const custCount   = custs   ? String((custs.data ?? []).length) : '—';

  const shieldedEnabled = process.env.NEXT_PUBLIC_SHIELDED_ENABLED === 'true';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-gray-400">Last 30 days · Live</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {!summary ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard title="Gross Revenue"        value={revenue}    change="" trend="up" icon={DollarSign} sub="last 30 days" />
            <StatCard title="Successful Payments"  value={successCnt} change="" trend="up" icon={CreditCard} sub={successRate} />
            <StatCard title="Active Subscriptions" value={subCount}   change="" trend="up" icon={RefreshCw}  sub="Kill Bill" />
            <StatCard title="Active Customers"     value={custCount}  change="" trend="up" icon={Users}      sub="this period" />
          </>
        )}
      </div>

      {/* Shielded Payments panel */}
      <div className="card p-5 flex items-start gap-4">
        <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center shrink-0">
          <ShieldCheck size={20} className="text-cyan-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-white">Shielded Payments</h3>
            {!shieldedEnabled && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-white/[0.06] border border-white/[0.1] text-gray-400">
                Feature disabled
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Zero-knowledge privacy for stablecoin payments. Merchants see commitments, not amounts.
          </p>
          {!shieldedEnabled ? (
            <a
              href="https://forgepay.dev/docs/shielded-payments"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-2 text-xs text-cyan-400 hover:text-cyan-300 transition-colors"
            >
              Learn more →
            </a>
          ) : (
            <div className="mt-2 text-xs text-cyan-400 font-semibold">
              {summary?.shielded_count ?? 0} shielded transactions
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>

        <div className="card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Payment Methods</h3>
          <div className="space-y-3">
            {[
              { label: 'Card',          pct: 71, color: '#00F0FF' },
              { label: 'USDC',          pct: 18, color: '#60A5FA' },
              { label: 'Crypto',        pct: 7,  color: '#A78BFA' },
              { label: 'Bank Transfer', pct: 4,  color: '#34D399' },
            ].map(({ label, pct, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white font-medium">{pct}%</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 pt-4 border-t border-white/[0.07]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400">Tax Collected (MoR)</div>
                <div className="text-base font-bold text-white mt-0.5">
                  {summary
                    ? (summary.tax_collected != null
                        ? fmt(summary.tax_collected)
                        : '–')
                    : '—'}
                </div>
              </div>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
                Remitted
              </span>
            </div>
          </div>
        </div>
      </div>

      <RecentPayments />
    </div>
  );
}
