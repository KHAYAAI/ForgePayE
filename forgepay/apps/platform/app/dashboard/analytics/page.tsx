'use client';

import { useEffect, useState } from 'react';
import {
  PageHeader,
  Stat,
  StatGrid,
  Panel,
  DataTable,
  Mono,
} from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   Analytics — real, tenant-scoped numbers only: team size and
   account activity from this console's own database (GET /api/team,
   GET /api/audit). No churn model, funnel tracker or email-campaign
   system exists yet, so those sections are gone rather than filled
   with invented metrics — a fresh account correctly shows almost
   nothing here.
   ──────────────────────────────────────────────────────────────── */

interface TeamMember { id: string; email: string; role: string; createdAt: string }
interface AuditEntry { id: string; action: string; actor_email: string | null; created_at: string }

export default function AnalyticsDashboard() {
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [events, setEvents] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    fetch('/api/team').then((r) => (r.ok ? r.json() : { data: [] })).then((b) => setTeam(b.data ?? []));
    fetch('/api/audit?limit=100').then((r) => (r.ok ? r.json() : { entries: [] })).then((b) => setEvents(b.entries ?? []));
  }, []);

  const actionCounts = (events ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.action] = (acc[e.action] ?? 0) + 1;
    return acc;
  }, {});
  const oldestMember = team && team.length > 0
    ? team.reduce((a, b) => (new Date(a.createdAt) < new Date(b.createdAt) ? a : b))
    : null;
  const accountAgeDays = oldestMember
    ? Math.max(0, Math.floor((Date.now() - new Date(oldestMember.createdAt).getTime()) / 86_400_000))
    : 0;

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Analytics"
        title={
          <>
            Your account, <em>measured</em>
          </>
        }
        lede="Team size and activity from this console's own record — the only analytics that exist today. Revenue and product-usage analytics arrive as each product's own data feed comes online."
      />

      <StatGrid>
        <Stat label="Team members" value={team?.length ?? '—'} delta="from your own roster" />
        <Stat label="Account age" value={oldestMember ? `${accountAgeDays} days` : '—'} delta={oldestMember ? 'since first sign-up' : 'no data yet'} />
        <Stat label="Audit events" value={events?.length ?? '—'} delta="recorded actions" />
        <Stat label="Distinct actions" value={Object.keys(actionCounts).length} delta="unique event types" />
      </StatGrid>

      <Panel title="Activity by Type" label="from your own audit log" style={{ marginBottom: 20 }}>
        <DataTable
          columns={['Action', 'Count']}
          emptyMessage="No activity recorded yet."
          rows={Object.entries(actionCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([action, count]) => [<Mono key="a">{action.replace(/[._]/g, ' ')}</Mono>, <Mono key="c">{count}</Mono>])}
        />
      </Panel>

      <Panel title="Team Roster" label="from your own account">
        <DataTable
          columns={['Email', 'Role', 'Joined']}
          emptyMessage="Loading…"
          rows={(team ?? []).map((m) => [
            m.email,
            <Mono key="r">{m.role}</Mono>,
            <Mono key="j">{new Date(m.createdAt).toLocaleDateString('en-US')}</Mono>,
          ])}
        />
      </Panel>
    </>
  );
}
