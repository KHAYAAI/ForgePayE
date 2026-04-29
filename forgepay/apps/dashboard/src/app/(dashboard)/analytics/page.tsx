'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function fmt(cents: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

const PIE_DATA = [
  { name: 'Card',          value: 71 },
  { name: 'USDC',          value: 18 },
  { name: 'Crypto',        value: 7  },
  { name: 'Bank Transfer', value: 4  },
];

const PIE_COLORS: Record<string, string> = {
  Card:          '#00F0FF',
  USDC:          '#10B981',
  Crypto:        '#F59E0B',
  'Bank Transfer': '#6366F1',
};

const TOP_COUNTRIES = [
  { flag: '🇺🇸', name: 'United States', share: 45, revenue: '$128,400' },
  { flag: '🇬🇧', name: 'United Kingdom', share: 18, revenue: '$51,300'  },
  { flag: '🇩🇪', name: 'Germany',        share: 12, revenue: '$34,200'  },
  { flag: '🇨🇦', name: 'Canada',         share: 8,  revenue: '$22,800'  },
  { flag: '🇦🇺', name: 'Australia',      share: 7,  revenue: '$19,950'  },
];

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

      {/* Payment method breakdown */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Payment Method Breakdown</h3>
        <div className="flex flex-col lg:flex-row items-center gap-6">
          <ResponsiveContainer width="100%" height={220} className="lg:max-w-xs">
            <PieChart>
              <Pie
                data={PIE_DATA}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
              >
                {PIE_DATA.map((entry) => (
                  <Cell key={entry.name} fill={PIE_COLORS[entry.name]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(v: number) => [`${v}%`, 'Share']}
                contentStyle={{ background: '#0d1b2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 w-full space-y-2">
            {PIE_DATA.map((entry) => (
              <div key={entry.name} className="flex items-center justify-between text-xs py-2 border-b border-white/[0.05] last:border-0">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: PIE_COLORS[entry.name] }} />
                  <span className="text-gray-300">{entry.name}</span>
                </div>
                <span className="text-white font-semibold tabular-nums">{entry.value}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top countries */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <h3 className="text-sm font-semibold text-white">Top Countries</h3>
        </div>
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Country</th>
              <th>Share</th>
              <th>Revenue</th>
            </tr>
          </thead>
          <tbody>
            {TOP_COUNTRIES.map((row) => (
              <tr key={row.name}>
                <td>
                  <span className="flex items-center gap-2">
                    <span className="text-base">{row.flag}</span>
                    <span className="text-sm text-gray-200">{row.name}</span>
                  </span>
                </td>
                <td>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 max-w-[80px] h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-cyan-500"
                        style={{ width: `${row.share}%` }}
                      />
                    </div>
                    <span className="text-xs text-gray-300 tabular-nums w-8">{row.share}%</span>
                  </div>
                </td>
                <td className="text-sm font-semibold text-white tabular-nums">{row.revenue}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
