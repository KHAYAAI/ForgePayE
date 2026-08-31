'use client';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const PROFILE = {
  agentId: 'agent_prime_001',
  did: 'did:fp:0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
  operatorEntityId: 'EIN-82-1234567 (LLC)',
  score: 847,
  tier: 'PRIME',
  utilization: 24,
  paymentRate: 100,
  totalDebt: 2400,
  totalLimit: 10000,
  factors: [
    { code: 'STRONG_PAYMENT_HISTORY', description: '100% of payments made on time.', impact: 'positive', weight: 35 },
    { code: 'LOW_UTILIZATION',        description: 'Credit utilization at 24% — healthy range.', impact: 'positive', weight: 30 },
    { code: 'ESTABLISHED_HISTORY',    description: '24 months of credit history.', impact: 'positive', weight: 15 },
    { code: 'LIMITED_CREDIT_MIX',     description: 'Limited variety of credit types on record.', impact: 'neutral', weight: 10 },
  ],
  scoreHistory: [
    { month: 'Jan', score: 720 }, { month: 'Feb', score: 728 }, { month: 'Mar', score: 735 },
    { month: 'Apr', score: 741 }, { month: 'May', score: 738 }, { month: 'Jun', score: 750 },
    { month: 'Jul', score: 762 }, { month: 'Aug', score: 770 }, { month: 'Sep', score: 790 },
    { month: 'Oct', score: 808 }, { month: 'Nov', score: 831 }, { month: 'Dec', score: 847 },
  ],
  events: [
    { id: 'evt_004', type: 'identity_verified', amount: null, creditor: 'IRS', date: '2024-01-14', txHash: null },
    { id: 'evt_001', type: 'credit_opened', amount: 10000, creditor: 'ForgePay Internal', date: '2024-01-15', txHash: null },
    { id: 'evt_002', type: 'payment_on_time', amount: 1200, creditor: 'ForgePay Internal', date: '2024-02-01', txHash: '0xabc123…' },
    { id: 'evt_003', type: 'payment_on_time', amount: 1200, creditor: 'ForgePay Internal', date: '2024-03-01', txHash: '0xdef456…' },
  ],
  disputes: [],
  inquiries: [
    { id: 'inq_001', requestor: 'Aave V3', purpose: 'credit_application', date: '2024-01-10' },
  ],
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#111] border border-[#1E1E1E] px-3 py-2 text-xs font-mono">
      <div className="text-[#6B7280]">{label}</div>
      <div className="text-[#39D353]">{payload[0]?.value}</div>
    </div>
  );
};

export default function AgentProfilePage({ params }: { params: { agentId: string } }) {
  const agentId = params.agentId;

  return (
    <div className="p-6">
      {/* Back */}
      <button onClick={() => history.back()} className="text-[10px] font-mono text-[#444] hover:text-white mb-5 flex items-center gap-1">
        ← AGENTS
      </button>

      <div className="grid grid-cols-5 gap-4">
        {/* Left — 2 cols */}
        <div className="col-span-2 space-y-4">

          {/* Score hero */}
          <div className="card p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280] mb-1">{agentId}</div>
            <div className="text-[10px] font-mono text-[#444] mb-4 truncate">{PROFILE.did}</div>
            <div className="flex items-baseline gap-3 mb-4">
              <span className="text-5xl font-mono font-bold text-white leading-none">{PROFILE.score}</span>
              <span className="text-[#39D353] text-sm font-mono border border-[#39D35340] px-2 py-0.5">{PROFILE.tier}</span>
            </div>
            {/* Score bar */}
            <div className="mb-1 flex justify-between text-[9px] font-mono text-[#333]">
              <span>300</span><span>500</span><span>670</span><span>800</span><span>1000</span>
            </div>
            <div className="h-2 bg-[#1A1A1A] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#EF4444] via-[#F59E0B] to-[#39D353]"
                style={{ width: `${((PROFILE.score - 300) / 700) * 100}%` }}
              />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-[#1A1A1A]">
              <div>
                <div className="text-[9px] font-mono uppercase text-[#444]">UTILIZATION</div>
                <div className="text-sm font-mono text-white font-bold mt-0.5">{PROFILE.utilization}%</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase text-[#444]">PAYMENT RATE</div>
                <div className="text-sm font-mono text-[#39D353] font-bold mt-0.5">{PROFILE.paymentRate}%</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase text-[#444]">TOTAL DEBT</div>
                <div className="text-sm font-mono text-white font-bold mt-0.5">${PROFILE.totalDebt.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[9px] font-mono uppercase text-[#444]">CREDIT LIMIT</div>
                <div className="text-sm font-mono text-white font-bold mt-0.5">${PROFILE.totalLimit.toLocaleString()}</div>
              </div>
            </div>
          </div>

          {/* Top risk factors */}
          <div className="card p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280] mb-4">TOP RISK FACTORS</div>
            <div className="space-y-3">
              {PROFILE.factors.map(f => (
                <div key={f.code} className="border-l-2 pl-3" style={{ borderColor: f.impact === 'positive' ? '#39D353' : f.impact === 'negative' ? '#EF4444' : '#6B7280' }}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={`text-[10px] font-mono font-bold ${f.impact === 'positive' ? 'text-[#39D353]' : f.impact === 'negative' ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>
                      {f.impact === 'positive' ? '+' : f.impact === 'negative' ? '−' : '○'} {f.code}
                    </span>
                    <span className="text-[9px] font-mono text-[#444]">{f.weight}%</span>
                  </div>
                  <div className="text-[10px] font-mono text-[#6B7280]">{f.description}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right — 3 cols */}
        <div className="col-span-3 space-y-4">

          {/* Score history chart */}
          <div className="card p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280] mb-4">12-MONTH SCORE HISTORY</div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={PROFILE.scoreHistory} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="0" stroke="#1A1A1A" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: '#444', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[700, 900]} tick={{ fill: '#444', fontSize: 10, fontFamily: 'JetBrains Mono' }} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="score" stroke="#39D353" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: '#39D353' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Credit events */}
          <div className="card">
            <div className="px-5 py-3 border-b border-[#1A1A1A]">
              <span className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280]">CREDIT EVENTS</span>
            </div>
            <table className="fp-table w-full">
              <thead>
                <tr><th>EVENT_TYPE</th><th>AMOUNT</th><th>CREDITOR</th><th>DATE</th><th>TX_HASH</th></tr>
              </thead>
              <tbody>
                {PROFILE.events.map(e => (
                  <tr key={e.id}>
                    <td className="font-mono text-xs">{e.type}</td>
                    <td className="font-mono text-xs text-[#39D353]">{e.amount ? `$${e.amount.toLocaleString()}` : '—'}</td>
                    <td className="font-mono text-xs text-[#6B7280]">{e.creditor}</td>
                    <td className="font-mono text-xs text-[#444]">{e.date}</td>
                    <td className="font-mono text-xs text-[#444]">{e.txHash ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Hard inquiries */}
          <div className="card p-5">
            <div className="text-[10px] font-mono uppercase tracking-widest text-[#6B7280] mb-3">HARD INQUIRIES (12 MONTHS)</div>
            {PROFILE.inquiries.length === 0 ? (
              <div className="text-[#444] text-xs font-mono">No inquiries on record.</div>
            ) : (
              <div className="space-y-2">
                {PROFILE.inquiries.map(inq => (
                  <div key={inq.id} className="flex items-center justify-between py-2 border-b border-[#1A1A1A] last:border-0">
                    <div>
                      <div className="text-xs font-mono text-white">{inq.requestor}</div>
                      <div className="text-[10px] font-mono text-[#444]">{inq.purpose}</div>
                    </div>
                    <div className="text-[10px] font-mono text-[#444]">{inq.date}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
