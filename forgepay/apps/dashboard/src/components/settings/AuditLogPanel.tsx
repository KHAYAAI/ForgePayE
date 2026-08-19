'use client';

import { useState, useEffect, useCallback } from 'react';
import { Loader2, LogIn, LogOut, ShieldCheck, ShieldOff, XCircle, UserPlus, Monitor } from 'lucide-react';
import { format } from 'date-fns';

/**
 * Account activity: sign-ins, MFA changes, session revocations.
 *
 * Paged by `before` (keyset on the row id) rather than an offset, so entries
 * arriving while someone is reading don't shift the page under them and cause
 * a row to be skipped.
 */

interface AuditEvent {
  id: string;
  action: string;
  actor_email: string | null;
  resource: string | null;
  detail: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

const PAGE_SIZE = 25;

/** Presentation per action. Unlisted actions still render, with a neutral look. */
const ACTIONS: Record<string, { label: string; icon: typeof LogIn; tone: string }> = {
  'auth.login_success':   { label: 'Signed in',                   icon: LogIn,       tone: 'text-emerald-400' },
  'auth.login_failed':    { label: 'Failed sign-in attempt',      icon: XCircle,     tone: 'text-red-400'     },
  'auth.logout':          { label: 'Signed out',                  icon: LogOut,      tone: 'text-gray-400'    },
  'auth.signup':          { label: 'Account created',             icon: UserPlus,    tone: 'text-cyan-400'    },
  'mfa.enrolled':         { label: 'Two-factor enabled',          icon: ShieldCheck, tone: 'text-emerald-400' },
  'mfa.disabled':         { label: 'Two-factor disabled',         icon: ShieldOff,   tone: 'text-amber-400'   },
  'mfa.challenge_failed': { label: 'Failed two-factor check',     icon: XCircle,     tone: 'text-red-400'     },
  'session.revoked':      { label: 'Session signed out',          icon: Monitor,     tone: 'text-gray-400'    },
  'session.revoked_all':  { label: 'All other sessions signed out', icon: Monitor,   tone: 'text-amber-400'   },
};

export default function AuditLogPanel() {
  const [events,  setEvents]  = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [more,    setMore]    = useState(false);
  const [done,    setDone]    = useState(false);
  const [error,   setError]   = useState('');

  const load = useCallback(async (before?: string) => {
    try {
      const url = new URL('/api/audit', window.location.origin);
      url.searchParams.set('limit', String(PAGE_SIZE));
      if (before) url.searchParams.set('before', before);

      const res = await fetch(url.toString());
      if (!res.ok) throw new Error();
      const data = await res.json();
      const page: AuditEvent[] = data.events ?? [];

      setEvents((prev) => (before ? [...prev, ...page] : page));
      // A short page means the end — no count query needed.
      if (page.length < PAGE_SIZE) setDone(true);
    } catch {
      setError('Could not load account activity.');
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function loadMore() {
    const last = events[events.length - 1];
    if (!last) return;
    setMore(true);
    void load(last.id);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2.5">
        {error}
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="text-xs text-gray-500">No account activity recorded yet.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="divide-y divide-white/[0.05]">
        {events.map((event) => {
          const meta = ACTIONS[event.action] ?? { label: event.action, icon: Monitor, tone: 'text-gray-400' };
          const Icon = meta.icon;
          return (
            <div key={event.id} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon size={14} className={`${meta.tone} mt-0.5 shrink-0`} />
                <div className="min-w-0">
                  <div className="text-sm text-white">{meta.label}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {[event.actor_email, event.ip_address, describeDetail(event.detail)]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
              </div>
              <time
                dateTime={event.created_at}
                className="shrink-0 text-xs text-gray-600 tabular-nums"
              >
                {safeFormat(event.created_at)}
              </time>
            </div>
          );
        })}
      </div>

      {!done && (
        <button
          type="button"
          onClick={loadMore}
          disabled={more}
          className="flex items-center gap-2 text-xs text-cyan-400 hover:text-cyan-300 disabled:opacity-50 transition-colors"
        >
          {more && <Loader2 size={12} className="animate-spin" />}
          {more ? 'Loading…' : 'Load older activity'}
        </button>
      )}
    </div>
  );
}

/** Surface the couple of detail fields worth reading; ignore the rest. */
function describeDetail(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;

  if (detail['via'] === 'sso')         return 'via SSO';
  if (detail['via'] === 'backup_code') return 'using a backup code';
  if (detail['reason'] === 'invalid_credentials') return 'wrong password';
  if (detail['reason'] === 'sso_ticket_invalid')  return 'expired SSO link';
  if (typeof detail['otherSessionsRevoked'] === 'number' && detail['otherSessionsRevoked'] > 0) {
    return `${detail['otherSessionsRevoked']} other session(s) ended`;
  }
  return null;
}

function safeFormat(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'd MMM, HH:mm');
}
