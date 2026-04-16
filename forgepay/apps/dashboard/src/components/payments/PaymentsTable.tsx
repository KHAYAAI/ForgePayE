'use client';

import Link from 'next/link';
import PaymentStatusBadge from './PaymentStatusBadge';

const PAYMENTS = Array.from({ length: 20 }, (_, i) => ({
  id:       `pay_01H${String(90 - i).padStart(2, '0')}`,
  amount:   [4900, 9900, 19900, 2900, 29900, 4900][i % 6],
  currency: i % 7 === 0 ? 'USDC' : i % 11 === 0 ? 'BTC' : 'USD',
  status:   i % 8 === 2 ? 'failed' : i % 12 === 0 ? 'refunded' : 'succeeded',
  method:   i % 5 === 0 ? 'usdc' : i % 9 === 0 ? 'bank' : 'card',
  customer: `customer+${i}@example.com`,
  country:  ['US', 'DE', 'GB', 'AU', 'CA', 'FR'][i % 6],
  created:  new Date(Date.now() - i * 3_600_000).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }),
}));

function fmt(cents: number, currency: string) {
  if (currency !== 'USD') return `${(cents / 100).toFixed(2)} ${currency}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

export default function PaymentsTable() {
  return (
    <div className="card overflow-hidden">
      <table className="w-full fp-table">
        <thead>
          <tr>
            <th>Payment ID</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Method</th>
            <th>Customer</th>
            <th>Country</th>
            <th>Date</th>
          </tr>
        </thead>
        <tbody>
          {PAYMENTS.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/payments/${p.id}`} className="font-mono text-xs text-cyan-400 hover:text-cyan-300">
                  {p.id}
                </Link>
              </td>
              <td className="font-medium tabular-nums">{fmt(p.amount, p.currency)}</td>
              <td><PaymentStatusBadge status={p.status} /></td>
              <td className="capitalize text-gray-400 text-xs">{p.method}</td>
              <td className="text-gray-400 text-xs truncate max-w-[160px]">{p.customer}</td>
              <td className="text-gray-500 text-xs">{p.country}</td>
              <td className="text-gray-500 text-xs whitespace-nowrap">{p.created}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Pagination */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.07]">
        <span className="text-xs text-gray-500">Showing 1–20 of 284</span>
        <div className="flex gap-1">
          {['← Prev', '1', '2', '3', '…', '15', 'Next →'].map((p) => (
            <button
              key={p}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                p === '1'
                  ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
