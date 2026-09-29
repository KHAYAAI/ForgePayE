'use client';

import { useEffect, useState } from 'react';
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

const ROLE_TONE: Partial<Record<string, 'ok' | 'warn' | 'danger' | 'accent'>> = {
  owner: 'ok',
  admin: 'accent',
  approver: 'warn',
};

export default function AdminDashboard() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);

  useEffect(() => {
    fetch('/api/team').then((r) => (r.ok ? r.json() : { data: [] })).then((b) => setTeam(b.data ?? []));
  }, []);

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
        <p className="lede" style={{ fontSize: 13, marginTop: 14 }}>
          Inviting additional team members isn&apos;t wired into the console yet — for now, new
          teammates sign up directly and an owner or admin promotes their role.
        </p>
      </Panel>
    </>
  );
}
