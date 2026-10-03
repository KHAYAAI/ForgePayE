'use client';

import { FormEvent, useState } from 'react';
import { PageHeader, Panel, Pill, DataTable, LivePill, Mono, Addr } from '@/components/forge/ui';
import { useCustody, formatEth, shortTime, askSignature, Proposal } from '@/components/forge/useCustody';
import { TxStatusPill, TxHash } from '@/components/forge/TxStatus';

/* FORGE Custody — Signing Queue. New transfers, and transfers held for
   approval. Every vote is attributed to the signed-in user. */

const label: React.CSSProperties = {
  display: 'block', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: 1.4,
  textTransform: 'uppercase', color: 'var(--steel)', marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', border: '1px solid var(--hair)', background: 'var(--paper)', padding: '10px 12px',
  fontSize: 13.5, color: 'var(--ink)', borderRadius: 0, fontFamily: 'inherit',
};

const STATUS_TONE: Record<Proposal['status'], 'ok' | 'warn' | 'danger'> = {
  open: 'warn',
  executed: 'ok',
  rejected: 'danger',
  failed: 'danger',
};

export default function SigningQueue() {
  const { data, live, act, busy, error, me } = useCustody();
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [outcome, setOutcome] = useState<string | null>(null);

  const queue = data.proposals.filter((p) => p.kind === 'approve_transaction');
  const net = data.network;
  const noNetwork = live && !net.rpc_configured;
  const rebroadcast = (requestId: string) => act({ action: 'rebroadcast', requestId });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOutcome(null);
    const result = await act({ action: 'transfer', to, amountEth: amount });
    if (!result) return;
    setOutcome(
      result.status === 'pending_approval'
        ? `Held for approval — needs ${result.requiredApprovals} signer approval(s).`
        : result.status === 'broadcasted'
          ? `Signed and broadcast to ${net.network_name ?? 'the network'}. Tx hash ${result.txHash}`
          : result.status === 'signed_not_broadcast'
            ? `Signed, but NOT broadcast: ${result.broadcastError ?? 'the network did not accept it'}. Use Rebroadcast once the network is reachable. Tx hash ${result.txHash}`
            : result.status === 'failed'
              ? `Signed, but the network refused it: ${result.broadcastError ?? 'unknown reason'}`
              : `Signed only — no network is configured, so nothing was sent and no funds moved. Tx hash ${result.txHash}`,
    );
    setTo('');
    setAmount('');
  }

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Signing Queue"
        title={<>Nothing moves <em>alone</em></>}
        lede="Transfers pass policy and sanctions screening first. Over 10 ETH, they wait here until enough signers approve; one rejection that makes quorum impossible ends them."
        actions={<LivePill live={live} />}
      />

      {noNetwork && (
        <Panel title="Signing only" label="no network configured" style={{ marginBottom: 20 }}>
          <p className="lede" style={{ fontSize: 14 }}>
            <strong>Signing only — no network configured.</strong> Transfers are approved and signed, but nothing is sent to a
            blockchain, so no funds move. Status stays “signed”.
          </p>
        </Panel>
      )}
      {error && <p style={{ fontSize: 13.5, marginBottom: 16, color: 'var(--danger)' }}>{error}</p>}

      <Panel
        title="New Transfer"
        label={net.rpc_configured ? `${net.network_name ?? 'network'} · screened before signing` : 'signing only — no network configured'}
        style={{ marginBottom: 20 }}
      >
        {net.rpc_configured && (
          <p style={{ fontSize: 13, marginBottom: 14, color: net.balance_wei === null ? 'var(--danger)' : 'var(--steel)' }}>
            {net.balance_wei !== null
              ? <>Balance <Mono>{formatEth(net.balance_wei)}</Mono> at <Addr>{net.address ?? ''}</Addr>. A transfer is refused up front if the balance can't cover the amount and fees.</>
              : `Balance unavailable — ${net.balance_error ?? 'no signing key yet'}.`}
          </p>
        )}
        {me?.eligible ? (
          <form onSubmit={submit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', gap: 16, alignItems: 'end' }}>
            <div>
              <label style={label}>Destination address</label>
              <input style={input} value={to} onChange={(e) => setTo(e.target.value)} placeholder="0x…" pattern="^0x[0-9a-fA-F]{40}$" required />
            </div>
            <div>
              <label style={label}>Amount (ETH)</label>
              <input style={input} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" required />
            </div>
            <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Submitting…' : 'Request transfer'}</button>
          </form>
        ) : (
          <p className="lede" style={{ fontSize: 13.5 }}>
            {me ? `Your signer access starts ${shortTime(me.active_from)}.` : 'Only active signers can request transfers.'}
          </p>
        )}
        {outcome && <p style={{ fontSize: 13, marginTop: 14, color: 'var(--ok)' }}>{outcome}</p>}
      </Panel>

      <Panel title="Approval Queue" label={`${data.settings.effective_required} of ${data.stats.active_signers} signers needed`}>
        <DataTable
          columns={['Raised', 'Amount', 'To', 'Approvals', 'Voted', 'Status', 'Tx hash', '']}
          emptyMessage="No transfer has needed approval yet."
          rows={queue.map((p) => {
            const approvals = p.votes.filter((v) => v.approve).length;
            const voted = p.votes.some((v) => v.email === data.viewer);
            return [
              <Mono key="w">{shortTime(p.created_at)}</Mono>,
              <Mono key="a">{formatEth(p.payload.request?.value)}</Mono>,
              <Addr key="t">{p.payload.request?.to}</Addr>,
              <Mono key="q">{approvals} / {p.required}</Mono>,
              p.votes.length ? p.votes.map((v) => `${v.email.split('@')[0]} ${v.approve ? '✓' : '✗'}`).join(', ') : '—',
              p.status === 'executed' && p.tx ? (
                <TxStatusPill key="s" status={p.tx.status} confirmations={p.tx.confirmations} detail={p.tx.detail} />
              ) : (
                <span key="s" title={p.result?.error ?? ''}>
                  <Pill tone={STATUS_TONE[p.status]}>{p.status === 'failed' ? 'approved · not signed' : p.status}</Pill>
                  {p.status === 'failed' && p.result?.error && (
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--danger)', maxWidth: 260, marginTop: 4 }}>{p.result.error}</span>
                  )}
                </span>
              ),
              <TxHash key="h" hash={p.tx?.tx_hash ?? p.result?.txHash} />,
              p.status === 'failed' && me?.eligible ? (
                <span key="b" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => act({ action: 'retry_transfer', proposalId: p.id })}>Retry signing</button>
                </span>
              ) : p.tx?.status === 'signed_not_broadcast' && me?.eligible && p.request_id ? (
                <span key="b" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => rebroadcast(p.request_id!)}>Rebroadcast</button>
                </span>
              ) : p.status === 'open' && me?.eligible && !voted ? (
                <span key="b" style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => { const sig = askSignature(p, true); if (sig !== null) act({ action: 'vote', proposalId: p.id, approve: true, ...(sig ? { signature: sig } : {}) }); }}>Approve</button>
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => { const sig = askSignature(p, false); if (sig !== null) act({ action: 'vote', proposalId: p.id, approve: false, ...(sig ? { signature: sig } : {}) }); }}>Reject</button>
                </span>
              ) : (
                <span key="n">—</span>
              ),
            ];
          })}
        />
      </Panel>

      <Panel
        title="Transfers"
        label={net.rpc_configured ? `every transfer · ${net.confirmations_required} confirmation(s) to settle` : 'every transfer · signing only'}
        style={{ marginTop: 20 }}
      >
        <DataTable
          columns={['When', 'To', 'Amount', 'Status', 'Tx hash', '']}
          emptyMessage="No transfers yet."
          rows={data.transactions.map((t) => [
            <Mono key="w">{shortTime(t.created_at)}</Mono>,
            <Addr key="to">{t.to_address}</Addr>,
            <Mono key="a">{formatEth(t.amount)}</Mono>,
            <TxStatusPill key="s" status={t.status} confirmations={t.confirmations} detail={t.detail} />,
            <span key="h">
              <TxHash hash={t.tx_hash} />
              {t.block_number ? <span style={{ display: 'block', fontSize: 11.5, color: 'var(--steel)' }}>block {t.block_number}</span> : null}
            </span>,
            t.status === 'signed_not_broadcast' && me?.eligible ? (
              <button key="b" className="btn-primary btn-sm" disabled={busy} onClick={() => rebroadcast(t.request_id)}>Rebroadcast</button>
            ) : <span key="n">—</span>,
          ])}
        />
      </Panel>
    </>
  );
}
