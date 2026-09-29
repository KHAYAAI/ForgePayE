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
   institutional consolidation view).

   Not yet backed by a live feed — there is no merchant-treasury
   service wired into this console today, so this renders the real
   state for every account: no settlements yet.
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
        lede="Multi-agent payout netting, sanctions screening on every settlement, and FX optimization across settlement currencies."
      />

      <StatGrid>
        <Stat label="Daily netting" value="$0" delta="no settlements yet" />
        <Stat label="Pending settlements" value={0} delta="none queued" />
        <Stat label="OFAC status" value="—" delta="no screens run yet" />
        <Stat label="FX savings (MTD)" value="$0" delta="vs market average" />
      </StatGrid>

      <Panel title="Agent Settlement Queue" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Agent', 'Payable', 'Status', 'Method']}
          rows={[]}
          emptyMessage="No settlements yet."
        />
      </Panel>

      <Panel title="OFAC Screening">
        <p className="lede" style={{ fontSize: 13 }}>No screens run yet — this appears the moment your first settlement is queued.</p>
      </Panel>
    </>
  );
}
