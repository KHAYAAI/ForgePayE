'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Stub data — replace with real API call via SWR
const DATA = [
  { date: 'Apr 1',  revenue: 4200  },
  { date: 'Apr 3',  revenue: 6100  },
  { date: 'Apr 5',  revenue: 5800  },
  { date: 'Apr 7',  revenue: 8400  },
  { date: 'Apr 9',  revenue: 7200  },
  { date: 'Apr 11', revenue: 9600  },
  { date: 'Apr 13', revenue: 11200 },
  { date: 'Apr 15', revenue: 10800 },
];

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

export default function RevenueChart() {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-white">Revenue</h3>
          <p className="text-xs text-gray-400">Last 15 days</p>
        </div>
        <div className="flex gap-1.5">
          {['7d', '30d', '90d'].map((p) => (
            <button
              key={p}
              className="text-[10px] px-2 py-0.5 rounded border border-white/10 text-gray-400 hover:text-white hover:border-white/20 transition-colors first:bg-white/[0.05] first:text-white"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={DATA} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="cyanGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#00F0FF" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#00F0FF" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
          <XAxis
            dataKey="date"
            tick={{ fill: '#8898AA', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
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
