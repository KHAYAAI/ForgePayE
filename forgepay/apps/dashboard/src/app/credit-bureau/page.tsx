'use client';
import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const SCORE_HISTORY = [
  { date: 'Jan',  score: 648, events: 312 },
  { date: 'Feb',  score: 659, events: 428 },
  { date: 'Mar',  score: 661, events: 391 },
  { date: 'Apr',  score: 670, events: 502 },
  { date: 'May',  score: 674, events: 618 },
  { date: 'Jun',  score: 688, events: 741 },
  { date: 'Jul',  score: 695, events: 809 },
  { date: 'Aug',  score: 698, events: 934 },
  { date: 'Sep',  score: 714, events: 1012 },
  { date: 'Oct',  score: 718, events: 1201 },
  { date: 'Nov',  score: 722, events: 1389 },
  { date: 'Dec',  score: 731, events: 1542 },
];

const RECENT_EVENTS = [
  { agent: 'agent_super_001', did: 'did:fp:0xdead…beef', event: 'payment_on_time',   delta: '+12', ts: '2024-12-26 08:14 UTC', status: 'success' },
  { agent: 'agent_prime_001', did: 'did:fp:0x7a3b…8b',   event: 'credit_opened',     delta: '+5',  ts: '2024-12-26 07:53 UTC', status: 'success' },
  { agent: 'agent_prime_002', did: 'did:fp:0x1a2b…0b',   event: 'payment_late_30',   delta: '−24', ts: '2024-12-26 06:40 UTC', status: 'error' },
  { agent: 'agent_subprime_001',did:'did:fp:0x9f8e…3c',  event: 'hard_inquiry',      delta: '−8',  ts: '2024-12-25 22:12 UTC', status: 'warning' },
  { agent: 'agent_deep_001',  did: 'did:fp:0x0000…dead', event: 'dispute_filed',     delta: '0',   ts: '2024-12-25 19:05 UTC', status: 'pending' },
  { agent: 'agent_prime_001', did: 'did:fp:0x7a3b…8b',   event: 'identity_verified', delta: '+18', ts: '2024-12-25 14:30 UTC', status: 'success' },
];

type Tab = 'score' | 'events';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111] border border-[#1E1E1E] px-3 py-2 text-xs font-mono">
      <div className="text-[#6B7280] mb-1">{label}</div>
      <div className="text-[#39D353]">Score: {payload[0]?.value}</div>
    </div>
  );
};

export default function CreditBureauPage() {
  const [tab, setTab] = useState<Tab>('score');

  return (
    <div className="p-6 space-y-6">
      {/* Hero metric — EigenExplorer style */}
      <div className="card p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="metric-value">$47,284,120.00</div>
            <div className="text-[#6B7280] text-xs font-mono mt-1">Total Credit Extended — All Agents</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-mono font-bold text-white">731</div>
            <div className="text-[#6B7280] text-[10px] font-mono uppercase tracking-wider mt-1">Bureau Score Index</div>
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex gap-1 mb-6">
          <button onClick={() => setTab('score')}  className={`tab-pill ${tab === 'score'  ? 'active' : ''}`}>SCORE INDEX</button>
          <button onClick={() => setTab('events')} className={`tab-pill ${tab === 'events' ? 'active' : ''}`}>CREDIT EVENTS</button>
        </div>

        {/* Chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={SCORE_HISTORY} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="0" stroke="#1A1A1A" vertical={false} />
              <XAxis dataKey="date" tick={{ fill: '#444', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <YAxis domain={[600, 800]} tick={{ fill: '#444', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey={tab === 'score' ? 'score' : 'events'}
                stroke="#39D353"
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3, fill: '#39D353' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="metric-label">REGISTERED AGENTS</div>
          <div className="text-2xl font-mono font-bold text-white mt-2">1,284</div>
          <div className="text-[#39D353] text-xs font-mono mt-1">↑ 142 this month</div>
        </div>
        <div className="card p-4">
          <div className="metric-label">AVG CREDIT SCORE</div>
          <div className="text-2xl font-mono font-bold text-white mt-2">731 <span className="text-sm text-[#39D353]">PRIME</span></div>
          <div className="text-[#39D353] text-xs font-mono mt-1">↑ 14 pts since Jan</div>
        </div>
        <div className="card p-4">
          <div className="metric-label">TOTAL CREDIT EXTENDED</div>
          <div className="text-2xl font-mono font-bold text-white mt-2">$47.3M</div>
          <div className="text-[#39D353] text-xs font-mono mt-1">↑ $8.2M this month</div>
        </div>
        <div className="card p-4">
          <div className="metric-label">30-DAY DELINQUENCY</div>
          <div className="text-2xl font-mono font-bold text-[#EF4444] mt-2">2.4%</div>
          <div className="text-[#EF4444] text-xs font-mono mt-1">↑ 0.3% vs last month</div>
        </div>
      </div>

      {/* Recent events table */}
      <div className="card">
        <div className="px-5 py-3 border-b border-[#1A1A1A] flex items-center justify-between">
          <span className="text-xs font-mono uppercase tracking-widest text-[#6B7280]">RECENT CREDIT EVENTS</span>
          <span className="text-[10px] font-mono text-[#39D353]">LIVE</span>
        </div>
        <table className="fp-table w-full">
          <thead>
            <tr>
              <th>AGENT_ID</th>
              <th>DID</th>
              <th>EVENT_TYPE</th>
              <th>SCORE_DELTA</th>
              <th>TIMESTAMP</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {RECENT_EVENTS.map((e, i) => (
              <tr key={i}>
                <td className="font-mono text-xs text-[#39D353]">{e.agent}</td>
                <td className="font-mono text-xs text-[#444]">{e.did}</td>
                <td className="font-mono text-xs">{e.event}</td>
                <td className={`font-mono text-xs font-bold ${e.delta.startsWith('−') ? 'text-[#EF4444]' : e.delta === '0' ? 'text-[#6B7280]' : 'text-[#39D353]'}`}>{e.delta}</td>
                <td className="font-mono text-xs text-[#444]">{e.ts}</td>
                <td><span className={`status-${e.status}`}>{e.status.toUpperCase()}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
