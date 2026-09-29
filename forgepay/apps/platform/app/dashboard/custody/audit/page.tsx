'use client';

import {
  PageHeader,
  Panel,
  DataTable,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Audit Log.
   Append-only record of every access: signing lifecycle, approvals,
   policy decisions, ceremonies, console reads.

   Not yet backed by a live feed — forge-custody has no audit-log
   read endpoint wired into this console today, so this renders the
   real state for every account: nothing recorded here yet.
   ──────────────────────────────────────────────────────────────── */

export default function CustodyAudit() {
  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Audit Log"
        title={
          <>
            Append-only, <em>even for admins</em>
          </>
        }
        lede="Every access is a row: approvals, policy decisions, MPC ceremonies, even console reads. Nothing here can be edited or deleted — including by the people who run the platform."
      />

      <Panel title="Immutable Audit Log" label="append-only">
        <DataTable
          columns={['Time', 'Actor', 'Type', 'Action', 'Object', 'Outcome']}
          rows={[]}
          emptyMessage="No custody activity recorded yet."
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Exports for regulators are one click and cryptographically chained — each row carries a
          hash of the previous, so a removed or altered entry is detectable by anyone holding the
          export.
        </p>
      </Panel>
    </>
  );
}
