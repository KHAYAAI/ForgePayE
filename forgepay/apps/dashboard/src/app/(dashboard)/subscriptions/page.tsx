'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Plus, RefreshCw, PauseCircle, PlayCircle, XCircle, Receipt } from 'lucide-react';
import { StatCardSkeleton, TableRowSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// Shape returned by GET /api/subscriptions (NormalizedSubscription from killbill-server)
interface Subscription {
  id:              string;
  planName:        string;
  status:          string;
  startDate:       string;
  nextBillingDate: string;
  amount:          number;   // in cents
  currency:        string;
}

// Upcoming invoice shape from Kill Bill
interface UpcomingInvoice {
  invoiceId:   string;
  targetDate:  string;
  amount:      number;
  currency:    string;
}

// ── Plan badge helper ─────────────────────────────────────────────────────────

const PLAN_BADGE: Record<string, { label: string; cls: string }> = {
  'growth-monthly': { label: 'Growth · Monthly', cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20' },
  'growth-annual':  { label: 'Growth · Annual',  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  'ai-tokens':      { label: 'AI Tokens',         cls: 'bg-violet-500/10 text-violet-400 border-violet-500/20' },
};

function planBadge(planName: string) {
  const key = Object.keys(PLAN_BADGE).find((k) => planName.includes(k));
  const { label, cls } = key ? PLAN_BADGE[key] : { label: planName, cls: 'bg-gray-500/10 text-gray-400 border-gray-500/20' };
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<string, string> = {
  active:    'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  trialing:  'bg-blue-500/10 text-blue-400 border-blue-500/20',
  past_due:  'bg-red-500/10 text-red-400 border-red-500/20',
  paused:    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  cancelled: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
};

// ── Format helpers ────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function fmtAmount(cents: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100);
}

// ── Action button ─────────────────────────────────────────────────────────────

function ActionButton({
  action,
  label,
  icon: Icon,
  className,
  onClick,
  loading,
}: {
  action: string;
  label: string;
  icon: React.ElementType;
  className: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      title={label}
      className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded transition-colors disabled:opacity-50 ${className}`}
    >
      <Icon size={12} />
      {loading ? '…' : label}
    </button>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SubscriptionsPage() {
  const {
    data,
    isLoading,
    mutate,
  } = useSWR<{ data: Subscription[]; count: number }>('/api/subscriptions', fetcher);

  // Upcoming invoice fetch (uses first subscription's implicit accountId — in practice
  // the API derives it from the session on the server side).
  const { data: invoiceData } = useSWR<UpcomingInvoice | { error: string }>(
    '/api/subscriptions/upcoming-invoice',
    fetcher,
    { shouldRetryOnError: false },
  );
  const upcomingInvoice = invoiceData && !('error' in invoiceData) ? invoiceData : null;

  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  const subs: Subscription[] = data?.data ?? [];
  const activeSubs = subs.filter((s) => s.status === 'active');

  async function handleAction(id: string, action: 'suspend' | 'resume' | 'cancel') {
    setActionLoading((prev) => ({ ...prev, [id]: true }));

    // Optimistic update
    await mutate(
      (current) => {
        if (!current) return current;
        const next = current.data.map((s) => {
          if (s.id !== id) return s;
          return {
            ...s,
            status: action === 'suspend' ? 'paused' : action === 'resume' ? 'active' : 'cancelled',
          };
        });
        return { ...current, data: next };
      },
      { revalidate: false },
    );

    try {
      const res = await fetch(`/api/subscriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
    } catch (err) {
      console.error(`[subscriptions] ${action} failed:`, err);
    } finally {
      // Revalidate to get authoritative state from Kill Bill
      await mutate();
      setActionLoading((prev) => ({ ...prev, [id]: false }));
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Subscriptions</h1>
          <p className="text-sm text-gray-400">
            {isLoading ? (
              <span className="text-gray-500">Loading…</span>
            ) : (
              <>
                <span className="text-white font-semibold">{activeSubs.length}</span> active
              </>
            )}
          </p>
        </div>
        <button className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors">
          <Plus size={13} /> New subscription
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {isLoading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          [
            { label: 'Active',        value: String(activeSubs.length) },
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
          ))
        )}
      </div>

      {/* Upcoming invoice */}
      {upcomingInvoice && (
        <div className="card p-4 flex items-center gap-3 border border-cyan-500/20">
          <Receipt size={16} className="text-cyan-400 shrink-0" />
          <div>
            <div className="text-[11px] text-gray-400 uppercase tracking-wide">Upcoming charge</div>
            <div className="text-white font-bold text-base">
              {fmtAmount(upcomingInvoice.amount, upcomingInvoice.currency)}
            </div>
            <div className="text-[11px] text-gray-500">
              Due {fmtDate(upcomingInvoice.targetDate)}
            </div>
          </div>
        </div>
      )}

      {/* Subscriptions table */}
      <div className="card overflow-hidden">
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Plan</th>
              <th>Status</th>
              <th>Next Charge</th>
              <th>Amount</th>
              <th>Start Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <TableRowSkeleton cols={7} />
                <TableRowSkeleton cols={7} />
                <TableRowSkeleton cols={7} />
              </>
            ) : subs.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-gray-500 py-8 text-sm">
                  No subscriptions found
                </td>
              </tr>
            ) : (
              subs.map((s) => {
                const isLoad = actionLoading[s.id] ?? false;
                const isPaused    = s.status === 'paused';
                const isActive    = s.status === 'active';
                const isCancelled = s.status === 'cancelled';
                return (
                  <tr key={s.id}>
                    <td className="text-gray-400 text-[11px] font-mono">
                      {s.id.slice(0, 8)}…
                    </td>
                    <td>{planBadge(s.planName)}</td>
                    <td>
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[s.status] ?? STATUS_STYLES.cancelled}`}>
                        {s.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="text-gray-400 text-xs">{fmtDate(s.nextBillingDate)}</td>
                    <td className="text-gray-300 text-xs">{fmtAmount(s.amount, s.currency)}</td>
                    <td className="text-gray-400 text-xs">{fmtDate(s.startDate)}</td>
                    <td>
                      {isCancelled ? (
                        <span className="text-[11px] text-gray-600">—</span>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          {isActive && (
                            <ActionButton
                              action="suspend"
                              label="Suspend"
                              icon={PauseCircle}
                              className="text-yellow-400 hover:bg-yellow-500/10"
                              onClick={() => handleAction(s.id, 'suspend')}
                              loading={isLoad}
                            />
                          )}
                          {isPaused && (
                            <ActionButton
                              action="resume"
                              label="Resume"
                              icon={PlayCircle}
                              className="text-emerald-400 hover:bg-emerald-500/10"
                              onClick={() => handleAction(s.id, 'resume')}
                              loading={isLoad}
                            />
                          )}
                          {!isCancelled && (
                            <ActionButton
                              action="cancel"
                              label="Cancel"
                              icon={XCircle}
                              className="text-red-400 hover:bg-red-500/10"
                              onClick={() => handleAction(s.id, 'cancel')}
                              loading={isLoad}
                            />
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
