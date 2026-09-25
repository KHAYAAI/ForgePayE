'use client';

import { useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  LivePill,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau — Disputes.
   FCRA-style 30-day resolution queue (GET /v1/disputes). An agent
   operator can dispute any credit event; the furnisher has 30 days
   to respond or the event is deleted from the file.
   ──────────────────────────────────────────────────────────────── */

type Dispute = {
  id: string;
  did: string;
  event: string;
  description: string;
  filed: string;
  clock: string;
  status: 'open' | 'investigating' | 'resolved_upheld' | 'resolved_corrected' | 'resolved_deleted';
};

const DEMO: { rows: Dispute[] } = {
  rows: [
    { id: 'dsp_881', did: 'did:forge:agent_078', event: 'payment_late_30', description: 'Payment was made on time — furnisher posted to the wrong agent.', filed: 'Jul 09', clock: '24 days left', status: 'open' },
    { id: 'dsp_874', did: 'did:forge:agent_231', event: 'hard_inquiry', description: 'Inquiry pulled without a valid consent token.', filed: 'Jul 02', clock: '17 days left', status: 'investigating' },
    { id: 'dsp_861', did: 'did:forge:agent_114', event: 'payment_late_60', description: 'Amount was disputed with the creditor before delinquency.', filed: 'Jun 18', clock: '—', status: 'resolved_corrected' },
    { id: 'dsp_855', did: 'did:forge:agent_009', event: 'default', description: 'Default claimed as identity theft by operator.', filed: 'Jun 12', clock: '—', status: 'resolved_upheld' },
    { id: 'dsp_840', did: 'did:forge:agent_001', event: 'hard_inquiry', description: 'Duplicate inquiry recorded twice for one application.', filed: 'Jun 03', clock: '—', status: 'resolved_deleted' },
  ],
};

const TONE: Record<Dispute['status'], 'ok' | 'warn' | 'danger' | 'accent'> = {
  open: 'warn',
  investigating: 'accent',
  resolved_upheld: 'danger',
  resolved_corrected: 'ok',
  resolved_deleted: 'ok',
};

interface DisputesSummary {
  rows: Dispute[];
  resolved90d?: number;
  correctedOrDeleted90d?: number;
  medianResolutionDays?: number | null;
  escalations?: number;
}

export default function BureauDisputes() {
  const { data, live } = useForge<DisputesSummary>('bureau-disputes', DEMO);
  const base = data.rows?.length ? data.rows : DEMO.rows;

  // Optimistic overlay for disputes just acted on — the next 15s poll
  // reconciles with the bureau's real state, but the click should read back
  // immediately rather than wait for it.
  const [overrides, setOverrides] = useState<Record<string, Dispute['status']>>({});
  const disputes = base.map((d) => (overrides[d.id] ? { ...d, status: overrides[d.id]! } : d));

  const startInvestigation = async (id: string) => {
    setOverrides((o) => ({ ...o, [id]: 'investigating' }));
    if (!live) return;
    const res = await fetch(`/api/forge/bureau-disputes/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'investigating' }),
    }).catch(() => null);
    if (!res?.ok) setOverrides((o) => { const next = { ...o }; delete next[id]; return next; });
  };

  const open = disputes.filter((d) => d.status === 'open' || d.status === 'investigating');

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Disputes"
        title={
          <>
            The right to <em>contest the file</em>
          </>
        }
        lede="FCRA-style process: an operator disputes an event, the furnisher gets 30 days to substantiate it, and an unanswered dispute deletes the event. Scores recompute the moment a dispute resolves."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Open disputes" value={open.length} deltaTone={open.length > 0 ? 'down' : undefined} delta="on the 30-day clock" />
        <Stat
          label="Resolved / 90d"
          value={live ? data.resolved90d ?? 0 : 14}
          delta={live ? `${data.correctedOrDeleted90d ?? 0} corrected or deleted` : '9 corrected or deleted'}
        />
        <Stat
          label="Median resolution"
          value={live ? (data.medianResolutionDays != null ? `${Math.round(data.medianResolutionDays)} days` : '—') : '11 days'}
          delta="30-day statutory limit"
          deltaTone="up"
        />
        <Stat label="Escalations" value={live ? data.escalations ?? 0 : 1} delta="clock exceeded → auto-delete" />
      </StatGrid>

      <Panel title="Dispute Queue" label="GET /v1/disputes · 30-day FCRA clock">
        <DataTable
          columns={['Dispute', 'Agent', 'Disputed event', 'Description', 'Filed', 'Clock', 'Status', '']}
          rows={disputes.map((d) => [
            <Mono key="id">{d.id}</Mono>,
            <Addr key="d">{d.did}</Addr>,
            <Mono key="e">{d.event}</Mono>,
            d.description,
            <Mono key="f">{d.filed}</Mono>,
            <Mono key="c">{d.clock}</Mono>,
            <Pill key="s" tone={TONE[d.status]}>{d.status.replace(/_/g, ' ')}</Pill>,
            d.status === 'open' ? (
              <button key="b" className="btn-ghost btn-sm" onClick={() => startInvestigation(d.id)}>
                Open investigation
              </button>
            ) : (
              <span key="b" />
            ),
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Every dispute and its resolution are themselves credit events — the file records that the
          file was contested. Furnishers who repeatedly post corrected data lose contributor query
          credits.
        </p>
      </Panel>
    </>
  );
}
