import type { Metadata } from 'next';
import { Plus, RefreshCw } from 'lucide-react';

export const metadata: Metadata = { title: 'Subscriptions' };

const SUBS = [
  { id: 'sub_01', customer: 'alice@acme.io',    plan: 'Pro Monthly',   status: 'active',   mrr: 4900,  next_charge: 'May 1' },
  { id: 'sub_02', customer: 'bob@startup.io',   plan: 'Growth Annual', status: 'active',   mrr: 9900,  next_charge: 'Mar 1, 2027' },
  { id: 'sub_03', customer: 'carol@co.io',      plan: 'Growth Monthly', status: 'trialing', mrr: 0,     next_charge: 'Apr 22 (trial)' },
  { id: 'sub_04', customer: 'david@corp.io',    plan: 'Pro Monthly',   status: 'past_due', mrr: 4900,  next_charge: 'Retry Apr 18' },
  { id: 'sub_05', customer: 'eve@web3.io',      plan: 'AI Tokens',     status: 'active',   mrr: 12000, next_charge: 'May 1' },
];

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  trialing:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  past_due:  'bg-red-500/10 text-red-400 border-red-500/20',
  cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

export default function SubscriptionsPage() {
  const totalMrr = SUBS.filter((s) => s.status === 'active').reduce((a, s) => a + s.mrr, 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Subscriptions</h1>
          <p className="text-sm text-gray-400">
            MRR: <span className="text-white font-semibold">${(totalMrr / 100).toFixed(2)}</span> · {SUBS.filter((s) => s.status === 'active').length} active
          </p>
        </div>
        <button className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors">
          <Plus size={13} /> New subscription
        </button>
      </div>

      {/* MRR summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'MRR',          value: `$${(totalMrr / 100).toFixed(0)}` },
          { label: 'Churn (30d)',   value: '2.1%' },
          { label: 'Trial → Paid', value: '68%' },
        ].map(({ label, value }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <RefreshCw size={14} className="text-cyan-400 shrink-0" />
            <div>
              <div className="text-base font-bold text-white">{value}</div>
              <div className="text-[11px] text-gray-400">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Plan</th>
              <th>Status</th>
              <th>MRR</th>
              <th>Next Charge</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {SUBS.map((s) => (
              <tr key={s.id}>
                <td className="text-gray-300 text-xs">{s.customer}</td>
                <td className="text-white text-sm font-medium">{s.plan}</td>
                <td>
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[s.status]}`}>
                    {s.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="font-medium tabular-nums text-sm">
                  {s.mrr > 0 ? `$${(s.mrr / 100).toFixed(2)}` : '—'}
                </td>
                <td className="text-gray-400 text-xs">{s.next_charge}</td>
                <td>
                  <button className="text-xs text-cyan-400 hover:text-cyan-300">Manage</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
