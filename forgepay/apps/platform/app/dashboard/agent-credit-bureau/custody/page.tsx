'use client';

import { useState } from 'react';
import { PageHeader, Panel, Pill, Mono } from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau: Custody data.
   If an agent pays through FORGE custody, custody can sign a short statement of how its payments have gone. Giving that
   statement to the bureau lets the agent's score show two things public chain data cannot: how often its payments go
   through, and how often it stays within its budget. Giving it is your consent. You can take it back at any time.
   ──────────────────────────────────────────────────────────────── */

type Summary = {
  agentId: string; custodyAgentId: string; keyAddress: string; agentStatus: string;
  issuedAt: string; expiresAt: string; expired: boolean; expiresInDays: number; renewalDue: boolean; erasedAfter: string;
  receivedAt: string; submittedBy: string;
  record: { transfers: number; released: number; refused: number; refusalsByReason: Record<string, number> };
  signals: { successRateBps: number | null; budgetComplianceRate: number | null; attempts: number } | null;
};

const ACK =
  'I am authorised to share this signed statement about my agent with the FORGE credit bureau. The bureau will use it to calculate my agent\'s ' +
  'score, which lenders I authorise may see. I can withdraw it at any time and the bureau will erase it.';

const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });
const pct = (n: number | null, scale: number) => (n === null ? 'not enough payments yet' : `${(n / scale * 100).toFixed(1)}%`);

export default function CustodyData() {
  const [agentId, setAgentId] = useState('');
  const [held, setHeld] = useState<Summary | null | undefined>(undefined);   // undefined: not looked up yet; null: nothing held
  const [statement, setStatement] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const lookup = async (id = agentId.trim()) => {
    setError(null); setNotice(null);
    if (!id) { setError('Enter the agent id.'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/forge/custody-attestation?agentId=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setHeld(undefined); setError(body?.message ?? 'Could not look that up.'); return; }
      setHeld(body.data as Summary | null);
    } catch { setError('Could not reach the console. Try again.'); } finally { setBusy(false); }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null); setNotice(null); setBusy(true);
    try {
      const res = await fetch('/api/forge/custody-attestation', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agentId.trim(), statement, acknowledged: ack }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.message ?? 'The statement was not accepted.'); return; }
      setHeld(body.data as Summary); setStatement(''); setAck(false);
      setNotice('The bureau accepted the statement. It now counts towards this agent\'s score until it expires.');
    } catch { setError('Could not reach the console. Try again.'); } finally { setBusy(false); }
  };

  const withdraw = async () => {
    if (!window.confirm('Withdraw this statement? The bureau will erase it and your agent\'s score will stop using it.')) return;
    setError(null); setNotice(null); setBusy(true);
    try {
      const res = await fetch(`/api/forge/custody-attestation?agentId=${encodeURIComponent(agentId.trim())}`, { method: 'DELETE' });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setError(body?.message ?? 'Could not withdraw it.'); return; }
      setHeld(null);
      setNotice('Withdrawn. The bureau has erased the statement.');
    } catch { setError('Could not reach the console. Consent was not withdrawn. Try again.'); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Custody data"
        title={<>Add your agent's <em>custody record</em></>}
        lede="If your agent pays through FORGE custody, a signed statement of how its payments have gone lets its score show how often they go through and how often it stays within budget. Sharing it is your choice, and you can take it back."
      />

      <Panel title="1. Choose the agent" label="your workspace's agents only">
        <form onSubmit={(e) => { e.preventDefault(); void lookup(); }} style={{ display: 'flex', gap: 12, alignItems: 'end', maxWidth: 560 }}>
          <label style={{ flex: 1 }}>Agent id
            <input required value={agentId} onChange={(e) => { setAgentId(e.target.value); setHeld(undefined); }} />
          </label>
          <button className="btn-primary" type="submit" disabled={busy}>Look up</button>
        </form>
        {error && <p role="alert" style={{ marginTop: 12 }}>{error}</p>}
        {notice && <p role="status" style={{ marginTop: 12 }}>{notice}</p>}
      </Panel>

      {held && (
        <Panel title="What the bureau holds" label="statement from custody">
          <p>
            {held.expired ? <Pill tone="danger">Expired</Pill> : held.renewalDue ? <Pill tone="warn">Renew soon</Pill> : <Pill tone="ok">Counting</Pill>}{' '}
            {held.expired
              ? <>It expired {when(held.expiresAt)} and no longer counts. The bureau will erase it after {when(held.erasedAfter)}.</>
              : <>Expires {when(held.expiresAt)} ({held.expiresInDays} day{held.expiresInDays === 1 ? '' : 's'} left).{held.renewalDue ? ' Ask your custody administrator for a fresh statement and add it below before then.' : ''}</>}
          </p>
          <ul>
            <li>Custody agent <Mono>{held.custodyAgentId}</Mono>, paying from <Mono>{held.keyAddress}</Mono></li>
            <li>Payments made: {held.record.transfers}; abandoned after passing every limit: {held.record.released}; refused: {held.record.refused}</li>
            <li>Added by {held.submittedBy} on {when(held.receivedAt)}</li>
            {held.signals && (
              <>
                <li>Share of attempted payments that went through: <strong>{pct(held.signals.successRateBps, 10000)}</strong></li>
                <li>Share of attempts within budget: <strong>{pct(held.signals.budgetComplianceRate === null ? null : held.signals.budgetComplianceRate * 10000, 10000)}</strong></li>
              </>
            )}
          </ul>
          <button className="btn-secondary" onClick={withdraw} disabled={busy}>Withdraw and erase</button>
        </Panel>
      )}

      {held !== undefined && (
        <Panel title={held ? '2. Replace it with a newer statement' : '2. Add a statement'} label="POST /api/forge/custody-attestation">
          <ol>
            <li>Ask your custody administrator for a statement for this agent: <Mono>GET /organisations/&#123;customerId&#125;/agents/&#123;agentId&#125;/attestation?subject={agentId || '<agent id>'}</Mono></li>
            <li>Paste the whole answer below, exactly as custody gave it. Do not edit it: any change makes the signature fail.</li>
          </ol>
          <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 720 }}>
            <label>Statement from custody
              <textarea required rows={8} value={statement} onChange={(e) => setStatement(e.target.value)} spellCheck={false} style={{ fontFamily: 'monospace', width: '100%' }} />
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ marginTop: 4 }} />
              <span>{ACK}</span>
            </label>
            <button className="btn-primary" type="submit" disabled={busy || !ack || !statement.trim()}>{busy ? 'Checking…' : 'Share with the bureau'}</button>
          </form>
        </Panel>
      )}
    </>
  );
}
