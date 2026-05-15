'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, RefreshCw } from 'lucide-react';
import { StatCardSkeleton, TableRowSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Subscription {
  subscription_id: string;
  customer_id: string;
  plan_id: string;
  status: string;
  current_period_end: string;
  start_date: string;
  cancelled_date?: string;
}

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  trialing:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  past_due:  'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export default function SubscriptionsPage() {
  const { data, isLoading } = useSWR<{ data: Subscription[]; count: number }>('/api/subscriptions', fetcher);

  const subs: Subscription[] = data?.data ?? [];
  const activeSubs = subs.filter((s) => s.status === 'active');

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Subscriptions</h1>
          <p className="text-sm text-gray-400">
            {isLoading ? (
              <span className="text-gray-500">Loading…</span>
            ) : (
              <>
                <span className="text-white font-semibold">{activeSubs.length}</span> active
              </>
            )}
          </p>
        </div>
        <button className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors">
          <Plus size={13} /> New subscription
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          [
            { label: 'Active',         value: String(activeSubs.length) },
            { label: 'Churn (30d)',    value: '2.1%' },
            { label: 'Trial → Paid',  value: '68%' },
          ].map(({ label, value }) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <RefreshCw size={14} className="text-cyan-400 shrink-0" />
              <div>
                <div className="text-base font-bold text-white">{value}</div>
                <div className="text-[11px] text-gray-400">{label}</div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Next Charge</th>
              <th>Start Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <TableRowSkeleton cols={6} />
                <TableRowSkeleton cols={6} />
                <TableRowSkeleton cols={6} />
              </>
            ) : (
              subs.map((s) => (
                <tr key={s.subscription_id}>
                  <td className="text-gray-300 text-xs">{s.customer_id}</td>
                  <td className="text-white text-sm font-medium">{s.plan_id}</td>
                  <td>
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[s.status] ?? STATUS_STYLES.cancelled}`}>
                      {s.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="text-gray-400 text-xs">{s.current_period_end}</td>
                  <td className="text-gray-400 text-xs">{s.start_date}</td>
                  <td>
                    <button className="text-xs text-cyan-400 hover:text-cyan-300">Manage</button>
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
