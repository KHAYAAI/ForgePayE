'use client';

import { FormEvent, useState } from 'react';
import { PageHeader, Panel, Pill, DataTable, LivePill, Mono, Addr } from '@/components/forge/ui';
import { useCustody, formatEth, shortTime, Proposal } from '@/components/forge/useCustody';

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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setOutcome(null);
    const result = await act({ action: 'transfer', to, amountEth: amount });
    if (!result) return;
    setOutcome(
      result.status === 'pending_approval'
        ? `Held for approval — needs ${result.requiredApprovals} signer approval(s).`
        : `Signed. Tx hash ${result.txHash}`,
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

      <Panel title="New Transfer" label="Sepolia · screened before signing" style={{ marginBottom: 20 }}>
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
        {error && <p style={{ fontSize: 13, marginTop: 14, color: 'var(--danger)' }}>{error}</p>}
      </Panel>

      <Panel title="Approval Queue" label={`${data.settings.effective_required} of ${data.stats.active_signers} signers needed`}>
        <DataTable
          columns={['Raised', 'Amount', 'To', 'Approvals', 'Voted', 'Status', '']}
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
              <Pill key="s" tone={STATUS_TONE[p.status]}>{p.status}</Pill>,
              p.status === 'open' && me?.eligible && !voted ? (
                <span key="b" style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => act({ action: 'vote', proposalId: p.id, approve: true })}>Approve</button>
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: 'vote', proposalId: p.id, approve: false })}>Reject</button>
                </span>
              ) : p.result?.txHash ? (
                <Mono key="h">{p.result.txHash.slice(0, 10)}…</Mono>
              ) : (
                <span key="n">—</span>
              ),
            ];
          })}
        />
      </Panel>
    </>
  );
}
