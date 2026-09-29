'use client';

import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  DataTable,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Payments — Disputes.
   Chargebacks and refunds with evidence deadlines. Submitting
   evidence or issuing a refund is a recorded, dual-visible action:
   it appears here and in the Compliance activity stream.

   Not yet backed by a live dispute feed — unified-router has no
   dispute/chargeback table today, so this always renders the real
   state for every account right now: zero disputes. Wire this to a
   real feed before this panel says anything else.
   ──────────────────────────────────────────────────────────────── */

export default function PaymentsDisputes() {
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
        <Stat label="Open disputes" value={0} delta="needs evidence or in review" />
        <Stat label="Disputed volume" value="$0.00" delta="of total volume" />
        <Stat label="Win rate" value="—" delta="no resolved disputes yet" />
        <Stat label="Evidence due soonest" value="—" delta="none pending" />
      </StatGrid>

      <Panel title="Dispute Queue" label="evidence deadlines enforced by card networks">
        <DataTable
          columns={['Dispute', 'Payment', 'Amount', 'Reason', 'Evidence due', 'Status']}
          rows={[]}
          emptyMessage="No disputes filed against your account."
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
