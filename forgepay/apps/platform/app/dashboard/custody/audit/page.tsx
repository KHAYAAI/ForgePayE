'use client';

import {
  PageHeader,
  Panel,
  DataTable,
  LivePill,
  Mono,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Audit Log.
   Live-wired to forge-custody's real console/summary `recent_audit`
   field (services/forge-custody/src/index.ts) — the last 10 audit
   entries for the workspace. forge-custody's own GET /api/v1/audit
   returns the full log, but requires a workspace API key the console
   doesn't hold; console/summary's CONSOLE_SECRET-gated slice is what
   this page can actually reach.
   ──────────────────────────────────────────────────────────────── */

interface AuditRow { at: string; actor: string; action: string; resource: string | null; status: number | null }
interface CustodySummary { recent_audit?: AuditRow[] }

const EMPTY: CustodySummary = { recent_audit: [] };

export default function CustodyAudit() {
  const { data, live } = useForge<CustodySummary>('custody', EMPTY);
  const rows = data.recent_audit ?? [];

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
        actions={<LivePill live={live} />}
      />

      <Panel title="Recent Audit Log" label="GET /api/v1/console/summary · last 10 entries">
        <DataTable
          columns={['Time', 'Actor', 'Action', 'Resource', 'Status']}
          rows={rows.map((e, i) => [
            <Mono key={`t${i}`}>{new Date(e.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</Mono>,
            e.actor,
            <Mono key={`a${i}`}>{e.action}</Mono>,
            e.resource ?? '—',
            <Mono key={`s${i}`}>{e.status ?? '—'}</Mono>,
          ])}
          emptyMessage="No custody activity recorded yet."
        />
      </Panel>
    </>
  );
}
