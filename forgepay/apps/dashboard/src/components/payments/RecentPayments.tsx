import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import PaymentStatusBadge from './PaymentStatusBadge';

// LAUNCH BLOCKER: STUB_PAYMENTS is hardcoded test data — this component never calls
// the API. Replace with a real data fetch:
//
//   'use client';
//   import useSWR from 'swr';
//   const { data, isLoading } = useSWR('/api/payments?limit=5', fetcher);
//   const payments = data?.data ?? [];
//
// The API route (src/app/api/payments/route.ts) is already wired to Hyperswitch.
// Add swr to package.json and delete STUB_PAYMENTS once connected.
const STUB_PAYMENTS = [
  { id: 'pay_01HZ', amount: 4900,  currency: 'USD',  status: 'succeeded', method: 'card',  customer: 'alice@acme.io',     created: '2 min ago' },
  { id: 'pay_01HY', amount: 9900,  currency: 'USD',  status: 'succeeded', method: 'usdc',  customer: 'bob@startup.io',    created: '15 min ago' },
  { id: 'pay_01HX', amount: 2900,  currency: 'USD',  status: 'failed',    method: 'card',  customer: 'carol@example.com', created: '1 hr ago' },
  { id: 'pay_01HW', amount: 19900, currency: 'USD',  status: 'succeeded', method: 'card',  customer: 'david@corp.io',     created: '2 hr ago' },
  { id: 'pay_01HV', amount: 4900,  currency: 'USDC', status: 'succeeded', method: 'usdc',  customer: 'eve@web3.io',       created: '3 hr ago' },
];

function formatAmount(cents: number, currency: string) {
  if (currency === 'USDC' || currency === 'USDT') {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
  return `$${(cents / 100).toFixed(2)}`;
}

export default function RecentPayments() {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
        <h3 className="text-sm font-semibold text-white">Recent Payments</h3>
        <Link href="/payments" className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
          View all <ArrowRight size={12} />
        </Link>
      </div>

      <table className="w-full fp-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Method</th>
            <th>Customer</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {STUB_PAYMENTS.map((p) => (
            <tr key={p.id}>
              <td>
                <Link href={`/payments/${p.id}`} className="font-mono text-xs text-cyan-400 hover:text-cyan-300">
                  {p.id}
                </Link>
              </td>
              <td className="font-medium">{formatAmount(p.amount, p.currency)}</td>
              <td><PaymentStatusBadge status={p.status} /></td>
              <td className="capitalize text-gray-400">{p.method}</td>
              <td className="text-gray-400">{p.customer}</td>
              <td className="text-gray-500">{p.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
