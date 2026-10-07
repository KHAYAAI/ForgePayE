'use client';

import { useState } from 'react';
import { PageHeader, Panel, Pill, DataTable, LivePill, Mono } from '@/components/forge/ui';
import { useForge } from '@/components/forge/useForge';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau: Consent.
   A lender can pull an agent's credit report only with a single-use consent
   token. Here the workspace that owns the agent authorises a named lender, and
   hands it the token. The token is shown once and never stored.
   ──────────────────────────────────────────────────────────────── */

type Consent = {
  jti: string;
  agent_id: string;
  requestor_id: string;
  purpose: string;
  issued_by: string;
  issued_at: string;
  expires_at: string;
  status: 'active' | 'used' | 'expired' | 'revoked';
};

const TONE: Record<Consent['status'], 'ok' | 'warn' | 'danger' | undefined> = { active: 'ok', used: 'accent' as 'ok', expired: undefined, revoked: 'warn' };
const PURPOSES = [
  ['credit_application', 'Credit application'],
  ['account_review', 'Account review'],
  ['employment', 'Employment'],
  ['insurance', 'Insurance'],
] as const;
const LIFETIMES = [['900', '15 minutes'], ['3600', '1 hour'], ['21600', '6 hours'], ['86400', '24 hours']] as const;

const when = (iso: string) => new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' });

export default function BureauConsent() {
  const { data, live, reload } = useForge<Consent[]>('bureau-consent', []);
  const [agentId, setAgentId] = useState('');
  const [requestorId, setRequestorId] = useState('');
  const [purpose, setPurpose] = useState<string>('credit_application');
  const [ttl, setTtl] = useState('3600');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string; agentId: string; requestorId: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const issue = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null); setIssued(null); setCopied(false);
    try {
      const res = await fetch('/api/forge/bureau-consent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentId: agentId.trim(), requestorId: requestorId.trim(), purpose, ttlSeconds: Number(ttl) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.message ?? 'Could not issue consent.');
      } else {
        setIssued({ token: body.data.consentToken, expiresAt: body.data.expiresAt, agentId: body.data.scope.agentId, requestorId: body.data.scope.requestorId });
        reload();
      }
    } catch {
      setError('Could not reach the console. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (jti: string) => {
    setError(null);
    const res = await fetch('/api/forge/bureau-consent/revoke', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jti }),
    }).catch(() => null);
    if (!res?.ok) setError((await res?.json().catch(() => null))?.message ?? 'Could not revoke. The consent is still valid.');
    reload();
  };

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Consent"
        title={<>Authorise a lender to <em>read the file</em></>}
        lede="A lender can pull one of your agents' credit reports only with your consent. Each authorisation is single-use and names the agent, the lender and the purpose."
        actions={<LivePill live={live} />}
      />

      <Panel title="Authorise a lender" label="POST /api/forge/bureau-consent">
        <form onSubmit={issue} style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <label>Agent id
            <input required value={agentId} onChange={(e) => setAgentId(e.target.value)} placeholder="the agent you registered" />
          </label>
          <label>Lender institution id
            <input required value={requestorId} onChange={(e) => setRequestorId(e.target.value)} placeholder="given to you by the lender" />
          </label>
          <label>Purpose
            <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              {PURPOSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label>Valid for
            <select value={ttl} onChange={(e) => setTtl(e.target.value)}>
              {LIFETIMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <button className="btn-primary" type="submit" disabled={busy || !live}>{busy ? 'Authorising…' : 'Authorise'}</button>
          {!live && <small>The bureau is not reachable, so consent cannot be issued right now.</small>}
        </form>
        {error && <p role="alert" style={{ marginTop: 12 }}>{error}</p>}
      </Panel>

      {issued && (
        <Panel title="Give this to the lender now" label="Shown once">
          <p>
            It works once, only for agent <Mono>{issued.agentId}</Mono> and lender <Mono>{issued.requestorId}</Mono>, until {when(issued.expiresAt)}.
            It cannot be shown again. If you lose it, authorise again.
          </p>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{issued.token}</pre>
          <button
            className="btn-ghost btn-sm"
            onClick={() => { navigator.clipboard?.writeText(issued.token).then(() => setCopied(true)).catch(() => setCopied(false)); }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </Panel>
      )}

      <Panel title="Authorisations" label="your workspace only">
        <DataTable
          columns={['Authorisation', 'Agent', 'Lender', 'Purpose', 'Issued', 'Expires', 'Status', '']}
          emptyMessage="You have not authorised any lender yet."
          rows={data.map((c) => [
            <Mono key="j">{c.jti.slice(0, 8)}</Mono>,
            <Mono key="a">{c.agent_id}</Mono>,
            <Mono key="r">{c.requestor_id}</Mono>,
            c.purpose.replace(/_/g, ' '),
            when(c.issued_at),
            when(c.expires_at),
            <Pill key="s" tone={TONE[c.status]}>{c.status}</Pill>,
            c.status === 'active'
              ? <button key="b" className="btn-ghost btn-sm" onClick={() => revoke(c.jti)}>Revoke</button>
              : <span key="b" />,
          ])}
        />
      </Panel>
    </>
  );
}
