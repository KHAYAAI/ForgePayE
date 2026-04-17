'use client';

import Link from 'next/link';
import { ArrowRight, Loader2 } from 'lucide-react';
import useSWR from 'swr';
import PaymentStatusBadge from './PaymentStatusBadge';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Payment {
  payment_id:       string;
  amount:           number;
  currency:         string;
  status:           string;
  payment_method?:  string;
  customer_id?:     string;
  created?:         string;
}

function formatAmount(cents: number, currency: string) {
  if (currency === 'USDC' || currency === 'USDT') return `${(cents / 100).toFixed(2)} ${currency}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'just now';
  if (mins < 60)  return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs  < 24)  return `${hrs} hr ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function RecentPayments() {
  const { data, isLoading } = useSWR('/api/payments?limit=5', fetcher);
  const payments: Payment[] = data?.data ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.07]">
        <h3 className="text-sm font-semibold text-white">Recent Payments</h3>
        <Link href="/payments" className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300">
          View all <ArrowRight size={12} />
        </Link>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8 text-gray-500">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading…
        </div>
      ) : payments.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-500">No payments yet.</div>
      ) : (
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
            {payments.map((p) => (
              <tr key={p.payment_id}>
                <td>
                  <Link href={`/payments/${p.payment_id}`} className="font-mono text-xs text-cyan-400 hover:text-cyan-300">
                    {p.payment_id}
                  </Link>
                </td>
                <td className="font-medium">{formatAmount(p.amount, p.currency)}</td>
                <td><PaymentStatusBadge status={p.status} /></td>
                <td className="capitalize text-gray-400">{p.payment_method ?? '—'}</td>
                <td className="text-gray-400">{p.customer_id ?? '—'}</td>
                <td className="text-gray-500">{relativeTime(p.created)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
