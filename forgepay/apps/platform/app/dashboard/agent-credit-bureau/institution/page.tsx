'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Panel, Pill, DataTable, Mono } from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Agent Credit Bureau: Institution access.
   A lender or furnisher (such as a microfinance institution) applies here for
   the bureau API. FORGE's operator reviews and approves. Once approved, the
   institution creates and revokes its own API keys here; a key is shown once.
   ──────────────────────────────────────────────────────────────── */

type Application = {
  id: string; tenant_id: string; name: string; institution_type: string; country: string; contact_email: string; intended_use: string;
  requested_scopes: string[]; status: 'pending' | 'provisioning' | 'approved' | 'rejected'; contributor_id: string | null;
  granted_scopes: string[] | null; decision_reason: string | null; created_at: string;
};
type Key = { id: string; label?: string; status: 'active' | 'revoked' | 'expired'; createdAt: string; expiresAt?: string; lastUsedAt?: string };

const TYPES: Array<[string, string]> = [['cefi_lender', 'Lender (for example a microfinance institution)'], ['bank', 'Bank'], ['defi_protocol', 'DeFi protocol'], ['saas_platform', 'Platform']];
const SCOPES: Array<[string, string]> = [['ingest_events', 'Report repayments'], ['pull_scores', 'Read scores and pull reports'], ['read_profile', 'Read histories and file disputes']];
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }) : '-');

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; body: T & { message?: string } }> {
  const res = await fetch(url, { cache: 'no-store', ...init, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  return { ok: res.ok, body: (await res.json().catch(() => ({}))) as T & { message?: string } };
}

export default function InstitutionAccess() {
  const [application, setApplication] = useState<Application | null>(null);
  const [isOperator, setIsOperator] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ data?: { application: Application | null; isOperator: boolean } }>('/api/forge/institution');
    if (r.ok && r.body.data) { setApplication(r.body.data.application); setIsOperator(r.body.data.isOperator); }
    setLoaded(true);
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Agent Credit Bureau / Institution access"
        title={<>Use the bureau <em>as an institution</em></>}
        lede="Lenders and data furnishers apply here for API access. Once approved you create your own keys, report repayments, pull reports with consent, and receive webhooks."
      />
      {error && <p role="alert">{error}</p>}
      {loaded && (!application || application.status === 'rejected') && <ApplyForm previous={application} onDone={load} onError={setError} />}
      {application && application.status !== 'rejected' && <Status application={application} />}
      {application?.status === 'approved' && <Keys onError={setError} />}
      {isOperator && <Queue onChanged={load} onError={setError} />}
    </>
  );
}

function ApplyForm({ previous, onDone, onError }: { previous: Application | null; onDone: () => void; onError: (m: string | null) => void }) {
  const [f, setF] = useState({ name: '', institutionType: 'cefi_lender', country: 'ZA', registrationNo: '', contactEmail: '', intendedUse: '' });
  const [scopes, setScopes] = useState<string[]>(['ingest_events', 'pull_scores', 'read_profile']);
  const [busy, setBusy] = useState(false);
  const toggle = (s: string) => setScopes((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); onError(null);
    const r = await api('/api/forge/institution', { method: 'POST', body: JSON.stringify({ ...f, registrationNo: f.registrationNo || undefined, requestedScopes: scopes }) });
    setBusy(false);
    if (!r.ok) return onError(r.body.message ?? 'Could not submit.');
    onDone();
  };

  return (
    <Panel title="Apply for access" label="POST /api/forge/institution">
      {previous?.status === 'rejected' && <p>Your previous application was not approved{previous.decision_reason ? `: ${previous.decision_reason}` : '.'} You can apply again.</p>}
      <form onSubmit={submit} style={{ display: 'grid', gap: 12, maxWidth: 620 }}>
        <label>Institution name<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Type
          <select value={f.institutionType} onChange={(e) => setF({ ...f, institutionType: e.target.value })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label>Country of registration<input required maxLength={2} value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} /></label>
        <label>Registration number<input value={f.registrationNo} onChange={(e) => setF({ ...f, registrationNo: e.target.value })} /></label>
        <label>Contact email<input required type="email" value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></label>
        <label>What will you use the API for?<textarea required rows={4} value={f.intendedUse} onChange={(e) => setF({ ...f, intendedUse: e.target.value })} /></label>
        <fieldset><legend>Access you need</legend>
          {SCOPES.map(([v, l]) => <label key={v} style={{ display: 'block' }}><input type="checkbox" checked={scopes.includes(v)} onChange={() => toggle(v)} /> {l}</label>)}
        </fieldset>
        <button className="btn-primary" type="submit" disabled={busy || scopes.length === 0}>{busy ? 'Submitting…' : 'Submit application'}</button>
      </form>
    </Panel>
  );
}

function Status({ application: a }: { application: Application }) {
  return (
    <Panel title="Your institution" label={a.name}>
      <p>
        Status: <Pill tone={a.status === 'approved' ? 'ok' : 'warn'}>{a.status === 'provisioning' ? 'being set up' : a.status}</Pill>
        {a.status === 'pending' && ' FORGE is reviewing your application. You will be able to create keys once it is approved.'}
        {a.status === 'provisioning' && ' Your approval is being completed.'}
      </p>
      {a.status === 'approved' && (
        <p>
          Institution id: <Mono>{a.contributor_id}</Mono>. Access: {(a.granted_scopes ?? []).join(', ')}. See the integration guide for the sandbox, the
          reporting endpoints, webhooks and the conformance script.
        </p>
      )}
    </Panel>
  );
}

function Keys({ onError }: { onError: (m: string | null) => void }) {
  const [keys, setKeys] = useState<Key[]>([]);
  const [label, setLabel] = useState('');
  const [shown, setShown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await api<{ data?: { keys: Key[] } }>('/api/forge/institution/keys');
    if (r.ok && r.body.data) setKeys(r.body.data.keys);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); onError(null); setShown(null);
    const r = await api<{ data?: { apiKey: string } }>('/api/forge/institution/keys', { method: 'POST', body: JSON.stringify({ label: label || undefined }) });
    setBusy(false);
    if (!r.ok) return onError(r.body.message ?? 'Could not create a key.');
    setShown(r.body.data?.apiKey ?? null); setLabel(''); void load();
  };
  const revoke = async (id: string) => {
    onError(null);
    const r = await api(`/api/forge/institution/keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!r.ok) onError(r.body.message ?? 'Could not revoke that key.');
    void load();
  };

  return (
    <>
      <Panel title="API keys" label="shown once, never stored by FORGE">
        <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <input placeholder="Label (for example production)" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
          <button className="btn-primary" type="submit" disabled={busy}>Create key</button>
        </form>
        <DataTable
          columns={['Key', 'Label', 'Created', 'Last used', 'Status', '']}
          emptyMessage="No keys yet. Create one to start."
          rows={keys.map((k) => [
            <Mono key="i">{k.id}</Mono>, k.label ?? '-', when(k.createdAt), when(k.lastUsedAt),
            <Pill key="s" tone={k.status === 'active' ? 'ok' : undefined}>{k.status}</Pill>,
            k.status === 'active' ? <button key="b" className="btn-ghost btn-sm" onClick={() => revoke(k.id)}>Revoke</button> : <span key="b" />,
          ])}
        />
      </Panel>
      {shown && (
        <Panel title="Copy your new key now" label="shown once">
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{shown}</pre>
          <p>It cannot be shown again. Store it in your secret manager. To rotate, create a new key, move over, then revoke the old one.</p>
        </Panel>
      )}
    </>
  );
}

function Queue({ onChanged, onError }: { onChanged: () => void; onError: (m: string | null) => void }) {
  const [rows, setRows] = useState<Application[]>([]);
  const [limits, setLimits] = useState<Record<string, { rpm: string; pulls: string }>>({});
  const load = useCallback(async () => {
    const r = await api<{ data?: Application[] }>('/api/forge/institution/applications?status=pending');
    const prov = await api<{ data?: Application[] }>('/api/forge/institution/applications?status=provisioning');
    if (r.ok) setRows([...(prov.body.data ?? []), ...(r.body.data ?? [])]);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const decide = async (a: Application, approve: boolean) => {
    onError(null);
    const l = limits[a.id] ?? { rpm: '', pulls: '' };
    let reason: string | undefined;
    if (!approve) { reason = window.prompt('Reason for rejecting (the applicant will see this):') ?? undefined; if (!reason) return; }
    const body: Record<string, unknown> = { approve, reason };
    if (approve && l.rpm) body.requestsPerMinute = Number(l.rpm);
    if (approve && l.pulls) body.maxPullsPerDay = Number(l.pulls);
    const r = await api(`/api/forge/institution/applications/${encodeURIComponent(a.id)}`, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) onError(r.body.message ?? 'Could not record that decision.');
    void load(); onChanged();
  };

  return (
    <Panel title="Applications to review" label="operator only">
      <DataTable
        columns={['Institution', 'Type', 'Country', 'Contact', 'Wants', 'Use', 'Limits (per min / pulls per day)', '']}
        emptyMessage="No applications waiting."
        rows={rows.map((a) => [
          a.name, a.institution_type.replace(/_/g, ' '), a.country, a.contact_email, a.requested_scopes.join(', '), a.intended_use,
          <span key="l" style={{ display: 'flex', gap: 4 }}>
            <input style={{ width: 70 }} placeholder="600" value={limits[a.id]?.rpm ?? ''} onChange={(e) => setLimits({ ...limits, [a.id]: { rpm: e.target.value, pulls: limits[a.id]?.pulls ?? '' } })} />
            <input style={{ width: 70 }} placeholder="none" value={limits[a.id]?.pulls ?? ''} onChange={(e) => setLimits({ ...limits, [a.id]: { rpm: limits[a.id]?.rpm ?? '', pulls: e.target.value } })} />
          </span>,
          <span key="b" style={{ display: 'flex', gap: 4 }}>
            <button className="btn-primary btn-sm" onClick={() => decide(a, true)}>{a.status === 'provisioning' ? 'Finish approval' : 'Approve'}</button>
            {a.status === 'pending' && <button className="btn-ghost btn-sm" onClick={() => decide(a, false)}>Reject</button>}
          </span>,
        ])}
      />
    </Panel>
  );
}
