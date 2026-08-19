'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Monitor, Loader2, LogOut } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

/**
 * Active sessions, and the ability to end them.
 *
 * Each row is a `sessions` record — the thing that actually gates access, so
 * revoking one takes effect on the next request that session makes rather
 * than whenever its JWT would have expired.
 */

interface SessionRow {
  id: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
}

export default function SessionsPanel() {
  const { data: session } = useSession();
  const currentId = session?.user?.sessionId;

  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [busyId,   setBusyId]   = useState<string | null>(null);
  const [busyAll,  setBusyAll]  = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } catch {
      setError('Could not load sessions.');
      setSessions([]);
    }
  }

  async function revoke(id: string) {
    setBusyId(id);
    setError('');
    try {
      const res = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      await refresh();
    } catch {
      setError('Could not sign that session out.');
    } finally {
      setBusyId(null);
    }
  }

  async function revokeOthers() {
    setBusyAll(true);
    setError('');
    try {
      const res = await fetch('/api/sessions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'revoke-all-except-current' }),
      });
      if (!res.ok) throw new Error();
      await refresh();
    } catch {
      setError('Could not sign the other sessions out.');
    } finally {
      setBusyAll(false);
    }
  }

  if (!sessions) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  const others = sessions.filter((s) => s.id !== currentId);

  return (
    <div className="space-y-3">
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2.5">
          {error}
        </div>
      )}

      {sessions.length === 0 ? (
        <p className="text-xs text-gray-500">No active sessions.</p>
      ) : (
        <div className="divide-y divide-white/[0.05]">
          {sessions.map((s) => {
            const isCurrent = s.id === currentId;
            return (
              <div key={s.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="flex items-start gap-2.5 min-w-0">
                  <Monitor size={15} className="text-gray-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white truncate">
                        {describeAgent(s.user_agent)}
                      </span>
                      {isCurrent && (
                        <span className="shrink-0 text-[10px] uppercase tracking-wider bg-cyan-500/15 text-cyan-300 px-1.5 py-0.5 rounded">
                          This device
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {s.ip_address ?? 'unknown IP'} · active {safeAgo(s.last_seen_at)}
                    </div>
                  </div>
                </div>

                {!isCurrent && (
                  <button
                    type="button"
                    onClick={() => revoke(s.id)}
                    disabled={busyId === s.id}
                    className="shrink-0 text-xs text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors"
                  >
                    {busyId === s.id ? 'Signing out…' : 'Sign out'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <button
          type="button"
          onClick={revokeOthers}
          disabled={busyAll}
          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 disabled:opacity-50 transition-colors pt-1"
        >
          {busyAll ? <Loader2 size={14} className="animate-spin" /> : <LogOut size={14} />}
          Sign out {others.length} other session{others.length === 1 ? '' : 's'}
        </button>
      )}
    </div>
  );
}

/** A readable label from a user-agent string — best effort, never throws. */
function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';

  const browser =
    /Edg\//.test(ua)                        ? 'Edge'    :
    /OPR\//.test(ua)                        ? 'Opera'   :
    /Chrome\//.test(ua)                     ? 'Chrome'  :
    /Safari\//.test(ua) && !/Chrome/.test(ua) ? 'Safari' :
    /Firefox\//.test(ua)                    ? 'Firefox' :
    null;

  const os =
    /Windows/.test(ua)            ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS'   :
    /Android/.test(ua)            ? 'Android' :
    /iPhone|iPad|iOS/.test(ua)    ? 'iOS'     :
    /Linux/.test(ua)              ? 'Linux'   :
    null;

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}

function safeAgo(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 'recently';
  return `${formatDistanceToNow(date)} ago`;
}
