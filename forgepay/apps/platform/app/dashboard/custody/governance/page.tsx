'use client';

import { FormEvent, useState } from 'react';
import { PageHeader, Stat, StatGrid, Panel, Pill, DataTable, Grid2, LivePill, Mono } from '@/components/forge/ui';
import { useCustody, shortTime } from '@/components/forge/useCustody';

/* FORGE Custody — Governance. Who can approve, and how many approvals it
   takes. Changing either is itself a proposal that needs the same quorum. */

const label: React.CSSProperties = {
  display: 'block', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: 1.4,
  textTransform: 'uppercase', color: 'var(--steel)', marginBottom: 6,
};
const input: React.CSSProperties = {
  width: '100%', border: '1px solid var(--hair)', background: 'var(--paper)', padding: '10px 12px',
  fontSize: 13.5, color: 'var(--ink)', borderRadius: 0, fontFamily: 'inherit',
};

export default function CustodyGovernance() {
  const { data, live, act, busy, error, me } = useCustody();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [threshold, setThreshold] = useState('');

  const active = data.signers.filter((s) => s.status === 'active');
  const governance = data.proposals.filter((p) => p.kind !== 'approve_transaction');
  const canPropose = !!me?.eligible;

  async function proposeAdd(e: FormEvent) {
    e.preventDefault();
    if (await act({ action: 'propose', kind: 'add_signer', payload: { email: email.trim().toLowerCase(), name: name.trim() || undefined } })) {
      setEmail('');
      setName('');
    }
  }

  async function proposeThreshold(e: FormEvent) {
    e.preventDefault();
    if (await act({ action: 'propose', kind: 'set_threshold', payload: { threshold: Number(threshold) } })) setThreshold('');
  }

  const describe = (kind: string, payload: Record<string, any>) =>
    kind === 'add_signer' ? `Add ${payload.email}` : kind === 'remove_signer' ? `Remove ${payload.email}` : `Threshold → ${payload.threshold}`;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Custody / Governance"
        title={<>Policy is the <em>product</em></>}
        lede="Adding or removing a signer, or changing how many approvals a transfer needs, is a proposal that needs the same quorum as a transfer. New signers wait out a cooling-off period before their vote counts."
        actions={<LivePill live={live} />}
      />

      <StatGrid>
        <Stat label="Threshold" value={data.settings.threshold} delta="approvals required, when enough signers exist" />
        <Stat label="Required right now" value={data.settings.effective_required} delta={`capped at ${active.filter((s) => s.eligible).length} eligible signer(s)`} />
        <Stat label="Cooling-off" value={`${data.settings.cooling_off_hours}h`} delta="before a new signer's vote counts" />
      </StatGrid>

      <Panel title="Signer Roster" label="people whose approval counts" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Signer', 'Status', 'Votes from', '']}
          emptyMessage="No signers yet — the first signer is set up from the Custody overview."
          rows={data.signers.map((s) => [
            <span key="n">{s.name ? `${s.name} · ` : ''}<Mono>{s.email}</Mono>{s.email === data.viewer ? ' (you)' : ''}</span>,
            <Pill key="s" tone={s.status === 'removed' ? 'danger' : s.eligible ? 'ok' : 'warn'}>
              {s.status === 'removed' ? 'removed' : s.eligible ? 'active' : 'cooling off'}
            </Pill>,
            <Mono key="f">{s.status === 'removed' ? '—' : shortTime(s.active_from)}</Mono>,
            s.status === 'active' && canPropose && active.length > 1 ? (
              <button key="r" className="btn-ghost btn-sm" disabled={busy}
                onClick={() => act({ action: 'propose', kind: 'remove_signer', payload: { email: s.email } })}>
                Propose removal
              </button>
            ) : <span key="r" />,
          ])}
        />
      </Panel>

      {canPropose && (
        <Grid2>
          <Panel title="Propose a Signer" label="needs quorum, then cooling-off">
            <form onSubmit={proposeAdd} style={{ display: 'grid', gap: 14 }}>
              <div><label style={label}>Email</label><input style={input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
              <div><label style={label}>Name · optional</label><input style={input} value={name} onChange={(e) => setName(e.target.value)} /></div>
              <button className="btn-primary" type="submit" disabled={busy}>Propose</button>
            </form>
          </Panel>
          <Panel title="Change the Threshold" label="how many approvals a proposal needs">
            <form onSubmit={proposeThreshold} style={{ display: 'grid', gap: 14 }}>
              <div><label style={label}>New threshold</label><input style={input} type="number" min={1} value={threshold} onChange={(e) => setThreshold(e.target.value)} required /></div>
              <button className="btn-primary" type="submit" disabled={busy}>Propose</button>
            </form>
          </Panel>
        </Grid2>
      )}
      {error && <p style={{ fontSize: 13, margin: '14px 0', color: 'var(--danger)' }}>{error}</p>}

      <Panel title="Governance Proposals" label="roster and threshold changes" style={{ marginTop: 20 }}>
        <DataTable
          columns={['Raised', 'Change', 'By', 'Approvals', 'Status', '']}
          emptyMessage="No governance changes proposed yet."
          rows={governance.map((p) => {
            const voted = p.votes.some((v) => v.email === data.viewer);
            return [
              <Mono key="w">{shortTime(p.created_at)}</Mono>,
              describe(p.kind, p.payload),
              p.created_by,
              <Mono key="a">{p.votes.filter((v) => v.approve).length} / {p.required}</Mono>,
              <Pill key="s" tone={p.status === 'executed' ? 'ok' : p.status === 'open' ? 'warn' : 'danger'}>{p.status}</Pill>,
              p.status === 'open' && canPropose && !voted ? (
                <span key="b" style={{ display: 'flex', gap: 8 }}>
                  <button className="btn-primary btn-sm" disabled={busy} onClick={() => act({ action: 'vote', proposalId: p.id, approve: true })}>Approve</button>
                  <button className="btn-ghost btn-sm" disabled={busy} onClick={() => act({ action: 'vote', proposalId: p.id, approve: false })}>Reject</button>
                </span>
              ) : <span key="b" />,
            ];
          })}
        />
      </Panel>
    </>
  );
}
