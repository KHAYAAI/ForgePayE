'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
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
  billing_details?: { address?: { country?: string } };
  created?:         string;
}

function fmt(cents: number, currency: string) {
  if (currency !== 'USD') return `${(cents / 100).toFixed(2)} ${currency}`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}

const PAGE_SIZE = 20;

export default function PaymentsTable() {
  const [page,   setPage]   = useState(1);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const url = `/api/payments?limit=${PAGE_SIZE}${cursor ? `&starting_after=${cursor}` : ''}`;
  const { data, isLoading } = useSWR(url, fetcher);

  const payments: Payment[] = data?.data ?? [];
  const hasMore = data?.has_more ?? false;

  function nextPage() {
    if (payments.length > 0) {
      setCursor(payments[payments.length - 1].payment_id);
      setPage((p) => p + 1);
    }
  }

  function prevPage() {
    if (page > 1) {
      setCursor(undefined);
      setPage(1);
    }
  }

  return (
    <div className="card overflow-hidden">
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <Loader2 size={16} className="animate-spin mr-2" /> Loading payments…
        </div>
      ) : (
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
            {payments.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-8 text-gray-500">No payments found.</td></tr>
            ) : payments.map((p) => (
              <tr key={p.payment_id}>
                <td>
                  <Link href={`/payments/${p.payment_id}`} className="font-mono text-xs text-cyan-400 hover:text-cyan-300">
                    {p.payment_id}
                  </Link>
                </td>
                <td className="font-medium tabular-nums">{fmt(p.amount, p.currency)}</td>
                <td><PaymentStatusBadge status={p.status} /></td>
                <td className="capitalize text-gray-400 text-xs">{p.payment_method ?? '—'}</td>
                <td className="text-gray-400 text-xs truncate max-w-[160px]">{p.customer_id ?? '—'}</td>
                <td className="text-gray-500 text-xs">{p.billing_details?.address?.country ?? '—'}</td>
                <td className="text-gray-500 text-xs whitespace-nowrap">
                  {p.created ? new Date(p.created).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t border-white/[0.07]">
        <span className="text-xs text-gray-500">Page {page}</span>
        <div className="flex gap-1">
          <button
            onClick={prevPage}
            disabled={page === 1}
            className="text-xs px-2.5 py-1 rounded text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={nextPage}
            disabled={!hasMore}
            className="text-xs px-2.5 py-1 rounded text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
