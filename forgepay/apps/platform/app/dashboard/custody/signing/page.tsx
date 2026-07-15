'use client';

import { useState } from 'react';
import {
  PageHeader,
  Panel,
  Pill,
  DataTable,
  LivePill,
  Mono,
  Addr,
} from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   FORGE Custody — Signing Queue.
   The full request lifecycle with approve/reject actions.
   Approvals are POST /api/v1/signing/:id/approve — signed calls
   from registered approver roles, distinct approvers enforced.
   ──────────────────────────────────────────────────────────────── */

type SigningRow = {
  id: string;
  workspace: string;
  destination: string;
  amount_usd: number;
  blockchain: string;
  status: string;
  reason_code: string | null;
  approvals: number;
  approvals_required: number;
  tx_hash: string | null;
};

interface CustodySummary {
  signing_queue: SigningRow[];
}

const DEMO: CustodySummary = {
  signing_queue: [
    { id: 'sig_a1b2', workspace: 'Investec Digital Assets', destination: '0xbridge…4f21', amount_usd: 5_000_000, blockchain: 'ethereum', status: 'pending_approval', reason_code: null, approvals: 1, approvals_required: 2, tx_hash: null },
    { id: 'sig_a1ae', workspace: 'Umuntu Group Treasury', destination: '0xsupplier…9c03', amount_usd: 50_000, blockchain: 'polygon', status: 'pending_approval', reason_code: null, approvals: 0, approvals_required: 1, tx_hash: null },
    { id: 'sig_a19f', workspace: 'Investec Digital Assets', destination: '0xcustody…77aa', amount_usd: 12_400_000, blockchain: 'ethereum', status: 'signing', reason_code: null, approvals: 2, approvals_required: 2, tx_hash: null },
    { id: 'sig_a18c', workspace: 'AfroBiz Lending', destination: '0xsettle…10de', amount_usd: 1_800_000, blockchain: 'polygon', status: 'confirmed', reason_code: null, approvals: 2, approvals_required: 2, tx_hash: '0x7f3a…' },
    { id: 'sig_a17b', workspace: 'Umuntu Group Treasury', destination: '0xunknown…e4d9', amount_usd: 3_200_000, blockchain: 'ethereum', status: 'rejected', reason_code: 'DESTINATION_NOT_WHITELISTED', approvals: 0, approvals_required: 0, tx_hash: null },
  ],
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  pending_policy: 'warn',
  pending_approval: 'warn',
  approved: 'accent',
  signing: 'accent',
  broadcast: 'accent',
  confirmed: 'ok',
  rejected: 'danger',
  failed: 'danger',
};

const usd = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

export default function CustodySigning() {
  const { data, live } = useForge<CustodySummary>('custody', DEMO);
  const [local, setLocal] = useState<Record<string, { approvals: number; status: string }>>({});

  const rows = data.signing_queue.map((r) => ({ ...r, ...local[r.id] }));

  const approve = (r: SigningRow) => {
    const approvals = (local[r.id]?.approvals ?? r.approvals) + 1;
    setLocal((l) => ({
      ...l,
      [r.id]: {
        approvals,
        status: approvals >= r.approvals_required ? 'signing' : 'pending_approval',
      },
    }));
  };

  const reject = (r: SigningRow) =>
    setLocal((l) => ({ ...l, [r.id]: { approvals: r.approvals, status: 'rejected' } }));

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Signing Queue"
        title={
          <>
            Nothing moves <em>alone</em>
          </>
        }
        lede="Every request passes the policy engine, collects its quorum, then goes to 4-of-7 MPC signing. Your approval here is a signed API call under your own registered role."
        actions={<LivePill live={live} />}
      />

      <Panel title="Signing Queue" label="policy → approval → 4-of-7 MPC → broadcast">
        <DataTable
          columns={['Request', 'Workspace', 'Destination', 'Amount', 'Chain', 'Approvals', 'Status', 'Tx', '']}
          rows={rows.map((r) => [
            <Mono key="id">{r.id}</Mono>,
            r.workspace,
            <Addr key="d">{r.destination}</Addr>,
            <Mono key="a">{usd(r.amount_usd)}</Mono>,
            <Mono key="c">{r.blockchain}</Mono>,
            <Mono key="ap">{r.approvals_required > 0 ? `${r.approvals} / ${r.approvals_required}` : '—'}</Mono>,
            <span key="s" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
              <Pill tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Pill>
              {r.reason_code && (
                <span style={{ fontSize: 11.5, color: 'var(--danger)' }}>{r.reason_code}</span>
              )}
            </span>,
            <Addr key="t">{r.tx_hash ?? '—'}</Addr>,
            r.status === 'pending_approval' ? (
              <span key="b" style={{ display: 'inline-flex', gap: 6 }}>
                <button className="btn-ghost btn-sm" onClick={() => approve(r)}>Approve</button>
                <button className="btn-ghost btn-sm" onClick={() => reject(r)}>Reject</button>
              </span>
            ) : (
              <span key="b" />
            ),
          ])}
        />
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          When the quorum completes, the MPC orchestrator collects encrypted shares and the status
          moves to <Mono>signing</Mono> — no human ever touches key material. A policy rejection
          (like <Mono>DESTINATION_NOT_WHITELISTED</Mono>) is final; resubmission requires a
          whitelist change, which is itself a governed vote.
        </p>
      </Panel>
    </>
  );
}
