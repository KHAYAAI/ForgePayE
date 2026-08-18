'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader, Panel, Pill, DataTable, Mono, LivePill } from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Console — Account Security Audit Log.
   Every sign-in, sign-out, MFA change, session revocation and API
   key rotation for this tenant. Distinct from Custody's own
   operational audit trail (signing/policy events) under
   /dashboard/custody/audit.
   ──────────────────────────────────────────────────────────────── */

interface AuditEntry {
  id: string;
  actor_email: string | null;
  action: string;
  resource: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

const ACTION_TONE: Record<string, 'ok' | 'warn' | 'danger' | 'accent' | undefined> = {
  'auth.login_success': 'ok',
  'auth.sso_login_success': 'ok',
  'auth.signup': 'ok',
  'auth.login_failed': 'danger',
  'mfa.challenge_failed': 'danger',
  'auth.logout': undefined,
  'mfa.enrolled': 'accent',
  'mfa.disabled': 'warn',
  'session.revoked': 'warn',
  'session.revoked_all': 'warn',
  'user.role_changed': 'accent',
  'user.api_key_rotated': 'accent',
};

function formatAction(action: string): string {
  return action.replace(/[._]/g, ' ');
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/audit?limit=100');
    if (res.status === 403) {
      setError("Your role doesn't include audit-log access.");
      return;
    }
    if (!res.ok) {
      setError('Could not load the audit log.');
      return;
    }
    const data = await res.json();
    setEntries(data.entries);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Account / Audit Log"
        title="Security events"
        lede="Sign-ins, sign-outs, two-factor changes, session revocations and API key rotations for everyone on your team."
        actions={<LivePill live={!error} />}
      />

      <Panel title="Recent events" label={entries ? `${entries.length} shown` : undefined}>
        {error && <Pill tone="danger">{error}</Pill>}
        {!error && !entries && <p className="lede" style={{ fontSize: 13 }}>Loading…</p>}
        {entries && entries.length === 0 && (
          <p className="lede" style={{ fontSize: 13 }}>No events recorded yet.</p>
        )}
        {entries && entries.length > 0 && (
          <DataTable
            columns={['Time', 'Actor', 'Event', 'IP']}
            rows={entries.map((e) => [
              <Mono key={`t${e.id}`}>{new Date(e.created_at).toLocaleString()}</Mono>,
              e.actor_email ?? '—',
              <Pill key={`a${e.id}`} tone={ACTION_TONE[e.action]}>{formatAction(e.action)}</Pill>,
              <Mono key={`i${e.id}`}>{e.ip_address ?? '—'}</Mono>,
            ])}
          />
        )}
      </Panel>
    </>
  );
}
