import type { Metadata } from 'next';
import { CreditCard, TrendingUp, Users, AlertCircle, RefreshCw, DollarSign } from 'lucide-react';
import StatCard from '@/components/dashboard/StatCard';
import RevenueChart from '@/components/dashboard/RevenueChart';
import RecentPayments from '@/components/payments/RecentPayments';

export const metadata: Metadata = { title: 'Overview' };

export default function OverviewPage() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Overview</h1>
        <p className="text-sm text-gray-400">April 2026 · Test mode</p>
      </div>

      {/* Stats grid */}
      {/* LAUNCH BLOCKER: all four StatCard values below are hardcoded.
          Replace with a server component that fetches from GET /api/analytics/summary
          and passes the real values as props, or use useSWR in a Client Component:
            const { data } = useSWR('/api/analytics/summary?days=30', fetcher);
          Map: data.gross_revenue_cents / 100 → Gross Revenue
               data.successful_count          → Successful Payments
               subscriptions API count        → Active Subscriptions
               customers API count            → Active Customers                 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Gross Revenue"
          value="$12,840"
          change="+18.2%"
          trend="up"
          icon={DollarSign}
          sub="vs last 30 days"
        />
        <StatCard
          title="Successful Payments"
          value="284"
          change="+12%"
          trend="up"
          icon={CreditCard}
          sub="96.2% success rate"
        />
        <StatCard
          title="Active Subscriptions"
          value="47"
          change="+3"
          trend="up"
          icon={RefreshCw}
          sub="2 trials ending soon"
        />
        <StatCard
          title="Active Customers"
          value="189"
          change="+24"
          trend="up"
          icon={Users}
          sub="this month"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <RevenueChart />
        </div>

        {/* Payment method breakdown */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-white mb-4">Payment Methods</h3>
          <div className="space-y-3">
            {[
              { label: 'Card',        pct: 71, color: '#00F0FF' },
              { label: 'USDC',        pct: 18, color: '#60A5FA' },
              { label: 'Crypto',      pct: 7,  color: '#A78BFA' },
              { label: 'Bank Transfer', pct: 4, color: '#34D399' },
            ].map(({ label, pct, color }) => (
              <div key={label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">{label}</span>
                  <span className="text-white font-medium">{pct}%</span>
                </div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </div>
            ))}
          </div>

          {/* Tax collected */}
          <div className="mt-5 pt-4 border-t border-white/[0.07]">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-gray-400">Tax Collected (MoR)</div>
                <div className="text-base font-bold text-white mt-0.5">$1,024.60</div>
              </div>
              <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full font-semibold">
                Remitted
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent payments */}
      <RecentPayments />
    </div>
  );
}
