'use client';

import { FormEvent, useEffect, useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  Pill,
  DataTable,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Admin — real team roster for this account (GET /api/team).

   The page previously here showed FORGE's own internal customer-
   success view of *other* merchants (fictional companies' churn
   risk, upsell targets, CSM assignments) — content that belongs to
   nobody's own console and was never real. Replaced with what an
   owner/admin of *this* account actually needs: who's on the team
   and what role they hold.
   ──────────────────────────────────────────────────────────────── */

interface TeamMember { id: string; email: string; role: string; status: string; createdAt: string }
interface PendingInvite { id: string; email: string; role: string; invited_by: string; expires_at: string }

const field: React.CSSProperties = {
  border: '1px solid var(--hair)', background: 'var(--paper)', padding: '10px 12px', fontSize: 13.5,
  color: 'var(--ink)', borderRadius: 0, fontFamily: 'inherit', width: '100%',
};

const ROLE_TONE: Partial<Record<string, 'ok' | 'warn' | 'danger' | 'accent'>> = {
  owner: 'ok',
  admin: 'accent',
  approver: 'warn',
};

export default function AdminDashboard() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [pending, setPending] = useState<PendingInvite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('approver');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ email: string; link: string; emailed: boolean } | null>(null);

  const load = () => {
    fetch('/api/team').then((r) => (r.ok ? r.json() : { data: [] })).then((b) => setTeam(b.data ?? []));
    fetch('/api/team/invitations').then((r) => (r.ok ? r.json() : { data: [] })).then((b) => setPending(b.data ?? []));
  };
  useEffect(load, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);
    const res = await fetch('/api/team/invitations', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, role }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(body?.error ?? 'Could not create the invitation.');
    setIssued({ email: body.data.email, link: body.data.link, emailed: body.data.emailed });
    setEmail('');
    load();
  }

  async function revoke(id: string) {
    await fetch(`/api/team/invitations/${id}`, { method: 'DELETE' });
    load();
  }

  const byRole = (team ?? []).reduce<Record<string, number>>((acc, m) => {
    acc[m.role] = (acc[m.role] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Admin"
        title={
          <>
            Your <em>team</em>
          </>
        }
        lede="Who has access to this account and what they can do — read from your own roster, nothing else."
      />

      <StatGrid>
        <Stat label="Team members" value={team?.length ?? '—'} delta="on this account" />
        <Stat label="Owners" value={byRole['owner'] ?? 0} delta="full access" />
        <Stat label="Admins" value={byRole['admin'] ?? 0} delta="manage:team, manage:api_keys" />
        <Stat label="Analysts" value={byRole['analyst'] ?? 0} delta="view-only" />
      </StatGrid>

      <Panel title="Team Roster" label="GET /api/team">
        <DataTable
          columns={['Email', 'Role', 'Status', 'Joined']}
          emptyMessage="Loading…"
          rows={(team ?? []).map((m) => [
            m.email,
            <Pill key="r" tone={ROLE_TONE[m.role]}>{m.role}</Pill>,
            <Pill key="s" tone={m.status === 'active' ? 'ok' : undefined}>{m.status}</Pill>,
            <Mono key="j">{new Date(m.createdAt).toLocaleDateString('en-US')}</Mono>,
          ])}
        />
      </Panel>

      <Panel title="Invite a Teammate" label="POST /api/team/invitations · link works once, expires in 7 days" style={{ marginTop: 20 }}>
        <form onSubmit={invite} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr) auto', gap: 12, alignItems: 'end' }}>
          <input style={field} type="email" placeholder="colleague@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <select style={field} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">admin — manage team &amp; keys</option>
            <option value="approver">approver — approve credit &amp; payouts</option>
            <option value="analyst">analyst — view only</option>
          </select>
          <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Inviting…' : 'Send invitation'}</button>
        </form>
        {error && <p style={{ color: 'var(--danger)', fontSize: 13, marginTop: 12 }}>{error}</p>}
        {issued && (
          <div style={{ marginTop: 16, border: '1px solid var(--ink)', padding: 14 }}>
            <p style={{ fontSize: 13, marginBottom: 8 }}>
              {issued.emailed ? `Emailed ${issued.email}. ` : `Email isn't configured, so nothing was sent to ${issued.email}. `}
              Send them this link yourself — it won't be shown again.
            </p>
            <Mono>{issued.link}</Mono>
          </div>
        )}
        <div style={{ marginTop: 20 }}>
          <DataTable
            columns={['Pending invitation', 'Role', 'Invited by', 'Expires', '']}
            emptyMessage="No pending invitations."
            rows={pending.map((p) => [
              p.email,
              <Pill key="r" tone={ROLE_TONE[p.role]}>{p.role}</Pill>,
              p.invited_by,
              <Mono key="e">{new Date(p.expires_at).toLocaleDateString('en-US')}</Mono>,
              <button key="x" className="btn-ghost btn-sm" onClick={() => revoke(p.id)}>Revoke</button>,
            ])}
          />
        </div>
      </Panel>
    </>
  );
}
