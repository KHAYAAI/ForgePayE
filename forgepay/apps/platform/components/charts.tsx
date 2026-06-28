'use client';

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

export function TransactionVolumeChart({ data }: { data: Array<{ time: string; transactions: number }> }) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="time" />
        <YAxis />
        <Tooltip />
        <Line
          type="monotone"
          dataKey="transactions"
          stroke="var(--cyan)"
          strokeWidth={2}
          dot={{ fill: 'var(--cyan)', r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SuccessRateChart({
  data,
}: {
  data: Array<{ name: string; rate: number; color: string }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="name" />
        <YAxis />
        <Tooltip formatter={(value) => `${value}%`} />
        <Bar dataKey="rate" radius={[8, 8, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueBreakdownChart({
  data,
}: {
  data: Array<{ name: string; value: number; color: string }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          labelLine={false}
          label={({ name, value }) => `${name}: ${value}%`}
          outerRadius={80}
          fill="#8884d8"
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip formatter={(value) => `${value}%`} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function OnboardingFunnelChart({
  data,
}: {
  data: Array<{ step: string; completion: number; color: string }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 30, left: 200, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis type="number" domain={[0, 100]} />
        <Tooltip formatter={(value) => `${value}%`} />
        <Bar dataKey="completion" radius={[0, 8, 8, 0]}>
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ChurnRateChart({
  data,
}: {
  data: Array<{ month: string; churnRate: number; target: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="month" />
        <YAxis />
        <Tooltip formatter={(value) => `${value}%`} />
        <Legend />
        <Line
          type="monotone"
          dataKey="churnRate"
          stroke="#FF6B6B"
          strokeWidth={2}
          name="Actual Churn"
        />
        <Line
          type="monotone"
          dataKey="target"
          stroke="#4ECB60"
          strokeWidth={2}
          strokeDasharray="5 5"
          name="Target (<3%)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SettlementSuccessChart({
  data,
}: {
  data: Array<{ date: string; success: number; failed: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="date" />
        <YAxis />
        <Tooltip />
        <Legend />
        <Bar dataKey="success" fill="var(--cyan)" name="Successful" />
        <Bar dataKey="failed" fill="#FF6B6B" name="Failed" />
      </BarChart>
    </ResponsiveContainer>
  );
}
