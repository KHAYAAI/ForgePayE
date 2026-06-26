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
    <div className="bg-[#111111] border border-[#1E1E1E] rounded px-3 py-2 text-xs font-mono">
      <div className="text-[#6B7280] mb-0.5">{label}</div>
      <div className="font-bold text-[#39D353]">${(payload[0].value / 100).toFixed(2)}</div>
    </div>
  );
}

const PERIOD_OPTIONS = [
  { label: '7D',  days: 7  },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

export default function RevenueChart() {
  const [days, setDays] = useState(30);
  const { data } = useSWR(`/api/analytics/revenue?days=${days}`, fetcher);
  const chartData = data?.daily ?? [];

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-xs font-mono font-medium uppercase tracking-widest text-[#6B7280]">Revenue</h3>
          <p className="text-[10px] text-[#444] font-mono mt-0.5">Last {days} days</p>
        </div>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.label}
              onClick={() => setDays(p.days)}
              className={`tab-pill ${days === p.days ? 'active' : ''}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={chartData} margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="greenGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#39D353" stopOpacity={0.08} />
              <stop offset="95%" stopColor="#39D353" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#1A1A1A" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v) => `$${(v / 100).toFixed(0)}`}
            tick={{ fill: '#444', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#1E1E1E', strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#39D353"
            strokeWidth={1.5}
            fill="url(#greenGrad)"
            dot={false}
            activeDot={{ r: 3, fill: '#39D353', stroke: '#0A0A0A', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
