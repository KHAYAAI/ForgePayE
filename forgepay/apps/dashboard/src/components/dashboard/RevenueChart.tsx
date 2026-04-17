'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface TooltipProps {
  active?:  boolean;
  payload?: Array<{ value: number }>;
  label?:   string;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-surface-800 border border-white/10 rounded-lg px-3 py-2 text-xs">
      <div className="text-gray-400 mb-0.5">{label}</div>
      <div className="font-bold text-white">${(payload[0].value / 100).toFixed(2)}</div>
    </div>
  );
}

const PERIOD_OPTIONS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

export default function RevenueChart() {
  const [days, setDays] = useState(15);
  const { data } = useSWR(`/api/analytics/revenue?days=${days}`, fetcher);
  const chartData = data?.daily ?? [];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-white">Revenue</h3>
          <p className="text-xs text-gray-400">Last {days} days</p>
        </div>
        <div className="flex gap-1.5">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${
                days === p.days
                  ? 'bg-white/[0.05] text-white border-white/20'
                  : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#00F0FF" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#00F0FF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
          <XAxis dataKey="date" tick={{ fill: '#8898AA', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
            tick={{ fill: '#8898AA', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#00F0FF"
            strokeWidth={2}
            fill="url(#cyanGrad)"
            dot={false}
            activeDot={{ r: 4, fill: '#00F0FF' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
