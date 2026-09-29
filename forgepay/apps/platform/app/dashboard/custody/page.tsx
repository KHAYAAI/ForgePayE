'use client';

import Link from 'next/link';
import { PageHeader, Stat, StatGrid, Panel, Pill, DataTable, LivePill, Mono, Addr } from '@/components/forge/ui';
import { useCustody, formatEth, shortTime } from '@/components/forge/useCustody';

/* FORGE Custody — Overview. Backed by openfireblocks
   (services/openfireblocks) via lib/openfireblocks.ts. */

const TX_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent'> = {
  signed: 'ok',
  broadcasted: 'ok',
  pending_approval: 'warn',
  rejected: 'danger',
  failed: 'danger',
};

export default function CustodyOverview() {
  const { data, live, act, busy, error, me } = useCustody();
  const waitingOnMe = data.proposals.filter(
    (p) => p.status === 'open' && me?.eligible && !p.votes.some((v) => v.email === data.viewer),
  );
  const noSigners = live && data.signers.every((s) => s.status !== 'active');

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody"
        title={<>Institutional <em>Custody</em></>}
        lede="Every transfer is screened against policy and sanctions. Anything over 10 ETH waits for a quorum of your signers before it is signed."
        actions={<LivePill live={live} />}
      />

      {noSigners && (
        <Panel title="Set up your workspace" label="no signers yet" ink style={{ marginBottom: 20 }}>
          <p className="lede" style={{ fontSize: 14, marginBottom: 16 }}>
            Nothing can be approved until someone is a signer. The first signer is you; every signer
            after that has to be voted in by the existing ones.
          </p>
          <button className="btn-primary" disabled={busy} onClick={() => act({ action: 'bootstrap_signer' })}>
            Become the first signer
          </button>
          {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        </Panel>
      )}

      <StatGrid>
        <Stat label="Signed / 24h" value={data.stats.signed_24h} delta={formatEth(data.stats.signed_wei_24h)} />
        <Stat
          label="Waiting for approval"
          value={data.stats.pending_approval}
          delta={data.stats.pending_approval > 0 ? 'see Signing Queue' : 'queue clear'}
          deltaTone={data.stats.pending_approval > 0 ? 'down' : undefined}
        />
        <Stat label="Denied / 7d" value={data.stats.denied_7d} delta="policy, sanctions, risk" />
        <Stat
          label="Active signers"
          value={data.stats.active_signers}
          delta={`${data.settings.effective_required} approval(s) needed now`}
        />
        <Stat label="Connected apps" value={data.stats.connected_apps} delta="active API keys" />
        <Stat
          label="Signing key"
          value={data.signing_key.threshold || '—'}
          delta={data.signing_key.signer_reachable ? 'signer online' : 'signer unreachable'}
          deltaTone={data.signing_key.signer_reachable ? 'up' : 'down'}
        />
      </StatGrid>

      <Panel title="Waiting on You" label="open approvals you haven't voted on" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['What', 'Detail', 'Approvals', 'Raised by', '']}
          emptyMessage={me ? 'Nothing is waiting on you.' : 'You are not a signer in this workspace.'}
          rows={waitingOnMe.map((p) => [
            <Mono key="k">{p.kind.replace('_', ' ')}</Mono>,
            p.kind === 'approve_transaction'
              ? `${formatEth(p.payload.request?.value)} → ${p.payload.request?.to?.slice(0, 10)}…`
              : JSON.stringify(p.payload),
            <Mono key="a">{p.votes.filter((v) => v.approve).length} / {p.required}</Mono>,
            p.created_by,
            <span key="b" style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary btn-sm" disabled={busy} onClick={() => act({ action: 'vote', proposalId: p.id, approve: true })}>Approve</button>
              <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: 'vote', proposalId: p.id, approve: false })}>Reject</button>
            </span>,
          ])}
        />
        {error && !noSigners && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
      </Panel>

      <Panel title="Recent Transfers" label="every transfer this workspace has requested">
        <DataTable
          columns={['When', 'To', 'Amount', 'Status', 'Tx hash']}
          emptyMessage="No transfers yet — start one from the Signing Queue."
          rows={data.transactions.slice(0, 10).map((t) => [
            <Mono key="w">{shortTime(t.created_at)}</Mono>,
            <Addr key="to">{t.to_address}</Addr>,
            <Mono key="a">{formatEth(t.amount)}</Mono>,
            <Pill key="s" tone={TX_TONE[t.status] ?? 'accent'}>{t.status.replace('_', ' ')}</Pill>,
            <Mono key="h">{t.tx_hash ? `${t.tx_hash.slice(0, 12)}…` : '—'}</Mono>,
          ])}
        />
        {data.transactions.length > 10 && (
          <p style={{ marginTop: 12, fontSize: 13 }}>
            <Link href="/dashboard/custody/audit">Full history in the Audit Log →</Link>
          </p>
        )}
      </Panel>
    </>
  );
}
