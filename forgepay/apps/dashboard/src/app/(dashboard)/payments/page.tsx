import type { Metadata } from 'next';
import { Download, Filter } from 'lucide-react';
import PaymentsTable from '@/components/payments/PaymentsTable';

export const metadata: Metadata = { title: 'Payments' };

export default function PaymentsPage() {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Payments</h1>
          <p className="text-sm text-gray-400">284 payments this month</p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-1.5 text-xs px-3 py-2 border border-white/10 rounded-lg text-gray-400 hover:text-white hover:border-white/20 transition-colors">
            <Filter size={12} /> Filters
          </button>
          <button className="flex items-center gap-1.5 text-xs px-3 py-2 border border-white/10 rounded-lg text-gray-400 hover:text-white hover:border-white/20 transition-colors">
            <Download size={12} /> Export CSV
          </button>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {['All', 'Succeeded', 'Failed', 'Processing', 'Refunded'].map((f) => (
          <button
            key={f}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              f === 'All'
                ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400'
                : 'border-white/10 text-gray-400 hover:text-white hover:border-white/20'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <PaymentsTable />
    </div>
  );
}
