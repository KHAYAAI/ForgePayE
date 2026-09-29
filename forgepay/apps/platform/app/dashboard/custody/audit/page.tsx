'use client';

import { PageHeader, Panel, Pill, DataTable, LivePill, Mono } from '@/components/forge/ui';
import { useCustody, shortTime } from '@/components/forge/useCustody';

/* FORGE Custody — Audit Log. openfireblocks' audit.events for this
   workspace: every request, policy decision, vote and signature, with the
   person who acted. */

const TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  executed: 'ok',
  signed: 'ok',
  broadcasted: 'ok',
  open: 'accent',
  pending: 'accent',
  pending_approval: 'warn',
  denied: 'danger',
  rejected: 'danger',
  failed: 'danger',
};

export default function CustodyAudit() {
  const { data, live } = useCustody();

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Audit Log"
        title={<>Every action, <em>attributed</em></>}
        lede="Requests, policy decisions, votes and signatures for this workspace, newest first, with who did each."
        actions={<LivePill live={live} />}
      />

      <Panel title="Audit Log" label="last 50 events">
        <DataTable
          columns={['When', 'Event', 'Who', 'Detail', 'Status']}
          emptyMessage="Nothing has happened in this workspace yet."
          rows={data.audit.map((e) => [
            <span key="w" style={{ whiteSpace: 'nowrap' }}><Mono>{shortTime(e.created_at)}</Mono></span>,
            <Mono key="t">{e.event_type}</Mono>,
            e.actor.includes('@') ? e.actor : <span key="a" style={{ color: 'var(--steel)' }}>system</span>,
            <span key="d" title={e.error_message ?? e.message ?? ''} style={{ display: 'block', maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {e.error_message ?? e.message ?? '—'}
            </span>,
            <Pill key="s" tone={TONE[e.status] ?? 'accent'}>{e.status.replace('_', ' ')}</Pill>,
          ])}
        />
      </Panel>
    </>
  );
}
