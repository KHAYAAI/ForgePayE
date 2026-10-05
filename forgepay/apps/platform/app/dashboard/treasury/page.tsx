'use client';

import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  DataTable,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Merchant Treasury — multi-agent payout netting, OFAC screening,
   FX optimization for merchants (distinct from Enterprise Treasury's
   institutional consolidation view, which is real-wired to the
   enterprise-treasury service).

   No backend for the payout-netting queue exists anywhere in this
   codebase — enterprise-treasury's own netting is intercompany
   (subsidiary ↔ subsidiary), not agent payouts, and no other service
   models this. OFAC screening is closer: forgepay/services/
   compliance-monitor is a real, separate Python/FastAPI service with
   working sanctions-screening routes (src/routers/ofac_screening.py,
   sanctions.py) — just not wired into this console, and this session
   didn't bring it up (different runtime, Python 3.12 vs the 3.11
   available here). Both stay a real, permanent empty state until one
   is built or connected.
   ──────────────────────────────────────────────────────────────── */

export default function TreasuryDashboard() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Merchant Treasury"
        title={
          <>
            Netting and <em>OFAC screening</em>
          </>
        }
        lede="Planned: multi-agent payout netting, sanctions screening on settlements, and FX optimisation. None of it is built or connected yet."
      />

      <StatGrid>
        <Stat label="Daily netting" value="$0" delta="no settlements yet" />
        <Stat label="Pending settlements" value={0} delta="none queued" />
        <Stat label="OFAC status" value="—" delta="screening not connected" />
        <Stat label="FX savings (MTD)" value="$0" delta="vs market average" />
      </StatGrid>

      <Panel title="Agent Settlement Queue" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Agent', 'Payable', 'Status', 'Method']}
          rows={[]}
          emptyMessage="No payout-netting service exists for this yet — see the page source for what would need to be built."
        />
      </Panel>

      <Panel title="OFAC Screening">
        <p className="lede" style={{ fontSize: 13 }}>
          A real sanctions-screening service exists (compliance-monitor) but isn&apos;t connected to
          this console yet — this panel will show real screens once it is.
        </p>
      </Panel>
    </>
  );
}
