'use client';

import { useState } from 'react';
import useSWR from 'swr';
import type { Metadata } from 'next';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);

  const { data: summary } = useSWR(`/api/analytics/summary?days=${days}`, fetcher);
  const { data: revenue  } = useSWR(`/api/analytics/revenue?days=${days}`, fetcher);

  const daily   = revenue?.daily ?? [];
  const sr      = summary ? ((summary.success_rate ?? 0) * 100).toFixed(1) : '—';
  const total   = summary ? fmt(summary.gross_revenue_cents ?? 0) : '—';
  const success = summary ? String(summary.successful_count ?? 0) : '—';
  const failed  = summary ? String(summary.failed_count ?? 0) : '—';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Analytics</h1>
          <p className="text-sm text-gray-400">Payment performance</p>
        </div>
        <div className="flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                days === d
                  ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                  : 'border-white/10 text-gray-400 hover:text-white'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Gross Revenue',     value: total   },
          { label: 'Successful',        value: success },
          { label: 'Failed',            value: failed  },
          { label: 'Success Rate',      value: sr + '%'},
        ].map(({ label, value }) => (
          <div key={label} className="card p-5">
            <div className="text-xs text-gray-400 mb-1">{label}</div>
            <div className="text-xl font-bold text-white">{value}</div>
          </div>
        ))}
      </div>

      {/* Revenue over time */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Daily Revenue</h3>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#00F0FF" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#00F0FF" stopOpacity={0}    />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="date" tick={{ fill: '#8898AA', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis
              tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
              tick={{ fill: '#8898AA', fontSize: 10 }}
              axisLine={false} tickLine={false}
            />
            <Tooltip
              formatter={(v: number) => [fmt(v), 'Revenue']}
              contentStyle={{ background: '#0d1b2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            />
            <Area type="monotone" dataKey="revenue" stroke="#00F0FF" strokeWidth={2} fill="url(#rev)" dot={false} activeDot={{ r: 4, fill: '#00F0FF' }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Transaction volume */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Daily Transaction Count</h3>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={daily} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
            <XAxis dataKey="date" tick={{ fill: '#8898AA', fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#8898AA', fontSize: 10 }} axisLine={false} tickLine={false} />
            <Tooltip
              contentStyle={{ background: '#0d1b2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
            />
            <Bar dataKey="count" fill="#00F0FF" opacity={0.7} radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
