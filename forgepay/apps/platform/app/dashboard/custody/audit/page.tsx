'use client';

import { useMemo, useState } from 'react';
import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Audit Log.
   Append-only record of every access: signing lifecycle, approvals,
   policy decisions, ceremonies, console reads. Filter by actor type.
   ──────────────────────────────────────────────────────────────── */

type AuditRow = {
  at: string;
  actor: string;
  kind: 'human' | 'system' | 'policy';
  action: string;
  resource: string;
  outcome: 'ok' | 'rejected';
};

const LOG: AuditRow[] = [
  { at: '14:47:12', actor: 'system', kind: 'system', action: 'signature.confirmed', resource: 'sig_a18c', outcome: 'ok' },
  { at: '14:31:04', actor: 'cfo@investec', kind: 'human', action: 'signing.approve', resource: 'sig_a1b2', outcome: 'ok' },
  { at: '14:29:55', actor: 'policy-engine', kind: 'policy', action: 'policy.reject', resource: 'sig_a17b', outcome: 'rejected' },
  { at: '14:12:38', actor: 'mpc-orchestrator', kind: 'system', action: 'shares.collected', resource: 'sig_a19f', outcome: 'ok' },
  { at: '13:58:20', actor: 'treasury@umuntu', kind: 'human', action: 'signing.create', resource: 'sig_a1ae', outcome: 'ok' },
  { at: '13:41:02', actor: 'ops@forge', kind: 'human', action: 'console.read', resource: 'keys inventory', outcome: 'ok' },
  { at: '11:20:44', actor: 'policy-engine', kind: 'policy', action: 'sanctions.screen', resource: 'sig_a1b2', outcome: 'ok' },
  { at: '09:02:11', actor: 'mpc-orchestrator', kind: 'system', action: 'ceremony.start', resource: 'key_treasury_ops', outcome: 'ok' },
  { at: '08:44:37', actor: 'cfo@investec', kind: 'human', action: 'governance.vote', resource: 'signer invite N. Mabaso', outcome: 'ok' },
];

const FILTERS = ['all', 'human', 'system', 'policy'] as const;

export default function CustodyAudit() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');

  const rows = useMemo(
    () => LOG.filter((r) => filter === 'all' || r.kind === filter),
    [filter],
  );

  const filterBtn = (active: boolean): React.CSSProperties => ({
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    padding: '7px 11px',
    border: '1px solid',
    borderColor: active ? 'var(--ink)' : 'var(--hair)',
    background: active ? 'var(--ink)' : 'transparent',
    color: active ? 'var(--paper)' : 'var(--steel)',
    cursor: 'pointer',
  });

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

      <div style={{ display: 'flex', gap: 5, alignItems: 'center', marginBottom: 18 }}>
        <span className="mono" style={{ marginRight: 4 }}>actor</span>
        {FILTERS.map((f) => (
          <button key={f} style={filterBtn(filter === f)} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      <Panel title="Immutable Audit Log" label={`${rows.length} of ${LOG.length} events · append-only`}>
        <DataTable
          columns={['Time', 'Actor', 'Type', 'Action', 'Object', 'Outcome']}
          rows={rows.map((e, i) => [
            <Mono key={`t${i}`}>{e.at}</Mono>,
            e.actor,
            <Pill key={`k${i}`} tone={e.kind === 'human' ? 'accent' : e.kind === 'policy' ? 'warn' : undefined}>{e.kind}</Pill>,
            <Mono key={`a${i}`}>{e.action}</Mono>,
            <Mono key={`o${i}`}>{e.resource}</Mono>,
            <Pill key={`s${i}`} tone={e.outcome === 'rejected' ? 'danger' : 'ok'}>{e.outcome}</Pill>,
          ])}
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
