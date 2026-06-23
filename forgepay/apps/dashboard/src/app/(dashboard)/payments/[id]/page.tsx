'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import useSWR from 'swr';
import { ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle, RefreshCw, Loader2 } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Payment {
  payment_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_method?: string;
  customer_id?: string;
  description?: string;
  created: string;
  attempt_count?: number;
  error_message?: string;
  error_code?: string;
  metadata?: Record<string, unknown>;
}

function statusBadge(status: string) {
  const map: Record<string, { cls: string; icon: React.ReactNode }> = {
    succeeded:  { cls: 'bg-green-500/10 border-green-500/20 text-green-400',   icon: <CheckCircle2 size={13} /> },
    failed:     { cls: 'bg-red-500/10 border-red-500/20 text-red-400',         icon: <XCircle size={13} /> },
    processing: { cls: 'bg-blue-500/10 border-blue-500/20 text-blue-400',      icon: <RefreshCw size={13} /> },
    requires_payment_method: {
      cls: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
      icon: <AlertCircle size={13} />,
    },
    refunded:   { cls: 'bg-purple-500/10 border-purple-500/20 text-purple-400', icon: <CheckCircle2 size={13} /> },
  };
  const s = map[status] ?? { cls: 'bg-gray-500/10 border-gray-500/20 text-gray-400', icon: <Clock size={13} /> };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold ${s.cls}`}>
      {s.icon}
      {status.replace(/_/g, ' ')}
    </span>
  );
}

const TIMELINE_STEPS = [
  { status: 'requires_payment_method', label: 'Payment method required' },
  { status: 'processing',              label: 'Processing' },
  { status: 'succeeded',               label: 'Succeeded' },
  { status: 'failed',                  label: 'Failed' },
  { status: 'refunded',                label: 'Refunded' },
];

function Timeline({ currentStatus }: { currentStatus: string }) {
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.status === currentStatus);

  return (
    <div className="space-y-0">
      {TIMELINE_STEPS.map((step, i) => {
        const isPast    = i < currentIndex;
        const isCurrent = step.status === currentStatus;
        const isFuture  = i > currentIndex;

        return (
          <div key={step.status} className="flex items-start gap-3">
            <div className="flex flex-col items-center">
              <div
                className={`w-3 h-3 rounded-full border-2 mt-1 transition-colors ${
                  isCurrent
                    ? 'border-cyan-400 bg-cyan-400'
                    : isPast
                    ? 'border-green-500 bg-green-500'
                    : 'border-white/20 bg-transparent'
                }`}
              />
              {i < TIMELINE_STEPS.length - 1 && (
                <div className={`w-0.5 h-6 ${isPast ? 'bg-green-500/40' : 'bg-white/10'}`} />
              )}
            </div>
            <p
              className={`text-sm pb-1 ${
                isCurrent ? 'text-white font-semibold' : isFuture ? 'text-gray-600' : 'text-gray-400'
              }`}
            >
              {step.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-gray-500 shrink-0 w-32">{label}</span>
      <div className="text-right">{children}</div>
    </div>
  );
}

export default function PaymentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, error } = useSWR<Payment>(`/api/payments/${id}`, fetcher);

  const [refundAmount, setRefundAmount] = useState('');
  const [refunding, setRefunding]       = useState(false);
  const [refundResult, setRefundResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleRefund = async () => {
    if (!data) return;
    setRefunding(true);
    setRefundResult(null);

    try {
      const amountCents = refundAmount
        ? Math.round(parseFloat(refundAmount) * 100)
        : data.amount;

      const res = await fetch(`/api/payments/${id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amountCents }),
      });

      if (res.ok) {
        setRefundResult({ success: true, message: 'Refund initiated successfully.' });
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setRefundResult({ success: false, message: err.error ?? 'Refund failed.' });
      }
    } catch {
      setRefundResult({ success: false, message: 'Network error. Please try again.' });
    } finally {
      setRefunding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-cyan-400" size={28} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link href="/payments" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Back to Payments
        </Link>
        <div className="card p-6 text-center">
          <XCircle className="mx-auto mb-3 text-red-400" size={32} />
          <p className="text-white font-semibold">Payment not found</p>
          <p className="text-sm text-gray-400 mt-1">This payment ID does not exist or cannot be loaded.</p>
        </div>
      </div>
    );
  }

  const amountFormatted = (data.amount / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: data.currency?.toUpperCase() ?? 'USD',
  });

  const defaultRefundAmount = (data.amount / 100).toFixed(2);

  return (
    <div className="space-y-6 max-w-5xl">
      {/* Back link */}
      <Link href="/payments" className="inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors">
        <ArrowLeft size={14} /> Back to Payments
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Payment ID</p>
          <code className="font-mono text-sm text-gray-200">{data.payment_id}</code>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-3xl font-bold text-white">{amountFormatted}</span>
            <span className="text-lg text-gray-400">{data.currency?.toUpperCase()}</span>
          </div>
        </div>
        <div className="mt-1">{statusBadge(data.status)}</div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Payment Details */}
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Payment Details</h2>
          <div className="space-y-0">
            <DetailRow label="Payment ID">
              <code className="font-mono text-xs text-gray-300">{data.payment_id}</code>
            </DetailRow>
            {data.payment_method && (
              <DetailRow label="Payment Method">
                <span className="capitalize text-sm text-gray-200">{data.payment_method.replace(/_/g, ' ')}</span>
              </DetailRow>
            )}
            {data.customer_id && (
              <DetailRow label="Customer ID">
                <code className="font-mono text-xs text-gray-300">{data.customer_id}</code>
              </DetailRow>
            )}
            {data.description && (
              <DetailRow label="Description">
                <span className="text-sm text-gray-200">{data.description}</span>
              </DetailRow>
            )}
            <DetailRow label="Created">
              <span className="text-sm text-gray-200">
                {new Date(data.created).toLocaleString('en-US', {
                  month: 'short', day: 'numeric', year: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </DetailRow>
            {data.attempt_count !== undefined && (
              <DetailRow label="Attempts">
                <span className="text-sm text-gray-200">{data.attempt_count}</span>
              </DetailRow>
            )}
            {data.error_message && (
              <DetailRow label="Error">
                <span className="text-sm text-red-400">{data.error_message}</span>
              </DetailRow>
            )}
          </div>
        </div>

        {/* Right: Timeline */}
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-white mb-5">Status Timeline</h2>
          <Timeline currentStatus={data.status} />
        </div>
      </div>

      {/* Refund section */}
      {data.status === 'succeeded' && (
        <div className="card p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white">Issue Refund</h2>
          <p className="text-xs text-gray-400">
            Refunds typically appear on the customer&apos;s statement within 5–10 business days.
          </p>

          {refundResult ? (
            <div
              className={`flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
                refundResult.success
                  ? 'bg-green-500/10 border border-green-500/20 text-green-400'
                  : 'bg-red-500/10 border border-red-500/20 text-red-400'
              }`}
            >
              {refundResult.success ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
              {refundResult.message}
            </div>
          ) : (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-400">{data.currency?.toUpperCase()}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={defaultRefundAmount}
                  placeholder={defaultRefundAmount}
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-36 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>
              <button
                onClick={handleRefund}
                disabled={refunding}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
              >
                {refunding && <Loader2 size={14} className="animate-spin" />}
                {refunding ? 'Processing...' : 'Issue Refund'}
              </button>
              <p className="text-xs text-gray-500">
                Leave blank to refund the full {amountFormatted}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
