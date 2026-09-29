'use client';

import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  LivePill,
  Mono,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Connected Applications.
   Live-wired to forge-custody's console/summary `connected_applications`
   field: one row per issued API key, joined to its workspace. This is
   the real record of what's actually connected to custody — not a
   marketing list of integrations, the literal key inventory.
   ──────────────────────────────────────────────────────────────── */

interface ConnectedApp {
  id: string;
  key_name: string;
  workspace_id: string;
  workspace_name: string;
  workspace_type: string;
  status: 'active' | 'suspended';
  connected_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface CustodySummary { connected_applications?: ConnectedApp[] }

const EMPTY: CustodySummary = { connected_applications: [] };

const WORKSPACE_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  bank: 'ok',
  fintech: 'accent',
  fund: 'accent',
  enterprise: 'accent',
  other: 'warn',
};

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

export default function CustodyConnections() {
  const { data, live } = useForge<CustodySummary>('custody', EMPTY);
  const apps = data.connected_applications ?? [];
  const active = apps.filter((a) => !a.revoked_at);

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Connected Applications"
        title={
          <>
            What's actually <em>connected</em>
          </>
        }
        lede="Every API key issued against custody, joined to the workspace that holds it — the real integration inventory, not a description of what could connect."
        actions={<LivePill live={live} />}
      />

      <Panel title="Connected Applications" label="GET /api/v1/console/summary · one row per issued API key" ink>
        <DataTable
          columns={['Application', 'Workspace', 'Type', 'Connected', 'Last used', 'Status']}
          emptyMessage="No applications connected yet — issue an API key to a workspace to connect one."
          rows={active.map((a) => [
            <Mono key="k">{a.key_name}</Mono>,
            a.workspace_name,
            <Pill key="t" tone={WORKSPACE_TONE[a.workspace_type] ?? 'accent'}>{a.workspace_type}</Pill>,
            <Mono key="c">{fmt(a.connected_at)}</Mono>,
            a.last_used_at ? <Mono key="u">{fmt(a.last_used_at)}</Mono> : <span key="u" style={{ color: 'var(--steel)', fontStyle: 'italic' }}>never used</span>,
            <Pill key="s" tone={a.status === 'active' ? 'ok' : 'danger'}>{a.status}</Pill>,
          ])}
        />
      </Panel>

      {apps.some((a) => a.revoked_at) && (
        <Panel title="Revoked" label="keys no longer able to reach custody" style={{ marginTop: 20 }}>
          <DataTable
            columns={['Application', 'Workspace', 'Connected', 'Revoked']}
            rows={apps.filter((a) => a.revoked_at).map((a) => [
              <Mono key="k">{a.key_name}</Mono>,
              a.workspace_name,
              <Mono key="c">{fmt(a.connected_at)}</Mono>,
              <Mono key="r">{fmt(a.revoked_at)}</Mono>,
            ])}
          />
        </Panel>
      )}
    </>
  );
}
