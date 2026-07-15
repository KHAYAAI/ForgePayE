'use client';

import { useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Disputes.
   Chargebacks and refunds with evidence deadlines. Submitting
   evidence or issuing a refund is a recorded, dual-visible action:
   it appears here and in the Compliance activity stream.
   ──────────────────────────────────────────────────────────────── */

type Dispute = {
  id: string;
  payment: string;
  merchant: string;
  amount: string;
  reason: string;
  due: string;
  status: 'needs_evidence' | 'under_review' | 'won' | 'lost' | 'refunded';
};

const INITIAL: Dispute[] = [
  { id: 'dp_2201', payment: 'pay_9f22', merchant: 'SnapPay', amount: 'R12,400', reason: 'fraudulent', due: '4 days', status: 'needs_evidence' },
  { id: 'dp_2199', payment: 'pay_9e81', merchant: 'AfroBiz Lending', amount: 'R3,150', reason: 'item not received', due: '9 days', status: 'needs_evidence' },
  { id: 'dp_2194', payment: 'pay_9d02', merchant: 'Umuntu Group', amount: 'R7,800', reason: 'duplicate charge', due: '—', status: 'under_review' },
  { id: 'dp_2187', payment: 'pay_9b44', merchant: 'Kasi Markets', amount: 'R860', reason: 'requested by customer', due: '—', status: 'refunded' },
  { id: 'dp_2180', payment: 'pay_9a01', merchant: 'SnapPay', amount: 'R5,200', reason: 'fraudulent', due: '—', status: 'won' },
  { id: 'dp_2166', payment: 'pay_98c7', merchant: 'ComputeRent', amount: 'R2,240', reason: 'credit not processed', due: '—', status: 'lost' },
];

const TONE: Record<Dispute['status'], 'ok' | 'warn' | 'danger' | 'accent'> = {
  needs_evidence: 'warn',
  under_review: 'accent',
  won: 'ok',
  lost: 'danger',
  refunded: 'accent',
};

export default function PaymentsDisputes() {
  const [disputes, setDisputes] = useState(INITIAL);

  const submitEvidence = (id: string) =>
    setDisputes((ds) => ds.map((d) => (d.id === id ? { ...d, status: 'under_review' as const, due: '—' } : d)));

  const open = disputes.filter((d) => d.status === 'needs_evidence' || d.status === 'under_review');
  const winRate = Math.round(
    (disputes.filter((d) => d.status === 'won').length /
      Math.max(1, disputes.filter((d) => d.status === 'won' || d.status === 'lost').length)) * 100,
  );

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Payments / Disputes"
        title={
          <>
            Disputes, <em>with deadlines</em>
          </>
        }
        lede="Chargebacks arrive with an evidence clock. Everything submitted here is countersigned into the Compliance activity stream — a dispute is never handled off the record."
      />

      <StatGrid>
        <Stat label="Open disputes" value={open.length} deltaTone={open.length > 0 ? 'down' : undefined} delta="needs evidence or in review" />
        <Stat label="Disputed volume" value="R23.4K" delta="0.55% of 24h volume" />
        <Stat label="Win rate" value={`${winRate}%`} delta="resolved disputes" deltaTone={winRate >= 50 ? 'up' : 'down'} />
        <Stat label="Evidence due soonest" value="4 days" delta="dp_2201 · R12,400" deltaTone="down" />
      </StatGrid>

      <Panel title="Dispute Queue" label="evidence deadlines enforced by card networks">
        <DataTable
          columns={['Dispute', 'Payment', 'Merchant', 'Amount', 'Reason', 'Evidence due', 'Status', '']}
          rows={disputes.map((d) => [
            <Mono key="id">{d.id}</Mono>,
            <Mono key="p">{d.payment}</Mono>,
            d.merchant,
            <Mono key="a">{d.amount}</Mono>,
            d.reason,
            <Mono key="due">{d.due}</Mono>,
            <Pill key="s" tone={TONE[d.status]}>{d.status.replace('_', ' ')}</Pill>,
            d.status === 'needs_evidence' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => submitEvidence(d.id)}>
                Submit evidence
              </button>
            ) : (
              <span key="b" />
            ),
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Refunds above R10,000 require a second approver (dual control) — the request routes to
          Compliance before funds move. Lost disputes automatically post a negative event to the
          merchant's ontology record.
        </p>
      </Panel>
    </>
  );
}
