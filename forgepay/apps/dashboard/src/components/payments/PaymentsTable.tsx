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
        <div className="flex items-center justify-center py-16 text-[#444] font-mono text-xs">
          <Loader2 size={14} className="animate-spin mr-2 text-[#39D353]" /> LOADING PAYMENTS…
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
              <tr>
                <td colSpan={7} className="text-center py-8 text-[#444] font-mono text-xs">
                  NO PAYMENTS FOUND
                </td>
              </tr>
            ) : payments.map((p) => (
              <tr key={p.payment_id}>
                <td>
                  <Link
                    href={`/payments/${p.payment_id}`}
                    className="font-mono text-xs text-[#39D353] hover:text-white transition-colors"
                  >
                    {p.payment_id}
                  </Link>
                </td>
                <td className="font-mono tabular-nums text-white">{fmt(p.amount, p.currency)}</td>
                <td><PaymentStatusBadge status={p.status} /></td>
                <td className="font-mono text-xs text-[#6B7280]">{p.payment_method ?? '—'}</td>
                <td className="font-mono text-xs text-[#6B7280] truncate max-w-[160px]">{p.customer_id ?? '—'}</td>
                <td className="font-mono text-xs text-[#444]">{p.billing_details?.address?.country ?? '—'}</td>
                <td className="font-mono text-xs text-[#444] whitespace-nowrap">
                  {p.created
                    ? new Date(p.created).toLocaleString('en-US', {
                        month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="flex items-center justify-between px-4 py-3 border-t border-[#1E1E1E]">
        <span className="text-[10px] text-[#444] font-mono uppercase tracking-widest">PAGE {page}</span>
        <div className="flex gap-1">
          <button
            onClick={prevPage}
            disabled={page === 1}
            className="text-[10px] font-mono px-2.5 py-1 rounded text-[#6B7280] hover:text-white hover:bg-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            ← PREV
          </button>
          <button
            onClick={nextPage}
            disabled={!hasMore}
            className="text-[10px] font-mono px-2.5 py-1 rounded text-[#6B7280] hover:text-white hover:bg-[#1A1A1A] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            NEXT →
          </button>
        </div>
      </div>
    </div>
  );
}
