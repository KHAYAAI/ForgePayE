'use client';

import { useEffect, useState, useCallback } from 'react';
import { PageHeader, Panel, Pill, DataTable, Mono, Grid2 } from '@/components/forge/ui';

/* ────────────────────────────────────────────────────────────────
   FORGE Console — Security Settings.
   Two real, live-wired controls: TOTP two-factor authentication, and
   session management ("where you're signed in", remote sign-out).
   ──────────────────────────────────────────────────────────────── */

interface SessionInfo {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
}

type EnrollStep = 'idle' | 'scanning' | 'backup-codes';

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function browserFromUA(ua: string | null): string {
  if (!ua) return 'Unknown device';
  if (ua.includes('Chrome')) return 'Chrome';
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Safari')) return 'Safari';
  return ua.slice(0, 40);
}

export default function SecuritySettings() {
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [enrollStep, setEnrollStep] = useState<EnrollStep>('idle');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disablePassword, setDisablePassword] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/user/sessions');
    if (res.ok) {
      const data = await res.json();
      setSessions(data.sessions);
    }
  }, []);

  useEffect(() => {
    loadSessions();
    // MFA status is inferred from whether /mfa/enroll refuses (409) — cheaper
    // is a dedicated status field, but this page has no separate "get me"
    // call today. Piggyback on the sessions payload instead by checking
    // after the first sessions load whether the user record's totp state is
    // needed — simplest correct approach: probe via a HEAD-less GET is not
    // available, so default to unknown until the user opens Enroll (the
    // enroll route itself reports "already enabled").
  }, [loadSessions]);

  async function startEnroll() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/user/mfa/enroll', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setMfaEnabled(true);
          setError('Two-factor authentication is already enabled on this account.');
        } else {
          setError(data.error ?? 'Could not start enrollment.');
        }
        return;
      }
      setQrCode(data.qrCodeDataUrl);
      setSecret(data.secret);
      setEnrollStep('scanning');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnroll() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/user/mfa/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Incorrect code.');
        return;
      }
      setBackupCodes(data.backupCodes);
      setEnrollStep('backup-codes');
      setMfaEnabled(true);
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  function finishEnrollment() {
    setEnrollStep('idle');
    setQrCode(null);
    setSecret(null);
    setBackupCodes(null);
  }

  async function disableMfa() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch('/api/user/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Could not disable two-factor authentication.');
        return;
      }
      setMfaEnabled(false);
      setShowDisableForm(false);
      setDisablePassword('');
    } finally {
      setBusy(false);
    }
  }

  async function revokeOne(id: string) {
    await fetch(`/api/user/sessions/${id}/revoke`, { method: 'POST' });
    await loadSessions();
  }

  async function revokeAllOthers() {
    await fetch('/api/user/sessions/revoke-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeCurrent: false }),
    });
    await loadSessions();
  }

  return (
    <>
      <PageHeader
        eyebrow="FORGE / Settings"
        title="Security"
        lede="Two-factor authentication and active sessions for your account."
      />

      <Grid2>
        <Panel
          title="Two-factor authentication"
          label={mfaEnabled === true ? 'enabled' : mfaEnabled === false ? 'not enabled' : undefined}
        >
          {enrollStep === 'idle' && (
            <>
              <p className="lede" style={{ fontSize: 13, marginBottom: 16 }}>
                {mfaEnabled
                  ? 'An authenticator app is required at sign-in, in addition to your password.'
                  : 'Require a code from an authenticator app (Google Authenticator, 1Password, Authy) at sign-in, in addition to your password.'}
              </p>
              {error && <Pill tone="danger">{error}</Pill>}
              {!mfaEnabled && (
                <button className="btn-primary" onClick={startEnroll} disabled={busy}>
                  {busy ? 'Starting…' : 'Enable two-factor authentication'}
                </button>
              )}
              {mfaEnabled && !showDisableForm && (
                <button className="btn-secondary" onClick={() => setShowDisableForm(true)}>Disable</button>
              )}
              {mfaEnabled && showDisableForm && (
                <div style={{ marginTop: 12 }}>
                  <p className="lede" style={{ fontSize: 13, marginBottom: 8 }}>
                    Confirm your password to disable two-factor authentication.
                  </p>
                  <input
                    type="password"
                    placeholder="Password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                    style={{ marginRight: 8, padding: '6px 10px' }}
                  />
                  <button className="btn-primary" onClick={disableMfa} disabled={busy || !disablePassword}>
                    {busy ? 'Disabling…' : 'Confirm disable'}
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ marginLeft: 8 }}
                    onClick={() => { setShowDisableForm(false); setDisablePassword(''); setError(null); }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </>
          )}

          {enrollStep === 'scanning' && qrCode && (
            <div>
              <p className="lede" style={{ fontSize: 13, marginBottom: 12 }}>
                Scan this with your authenticator app, or enter the code manually, then confirm with a
                6-digit code.
              </p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrCode} alt="TOTP enrollment QR code" width={180} height={180} style={{ marginBottom: 10 }} />
              <div style={{ marginBottom: 14 }}>
                <span className="mono" style={{ marginRight: 6 }}>manual entry:</span>
                <Mono>{secret}</Mono>
              </div>
              {error && <Pill tone="danger">{error}</Pill>}
              <div style={{ marginTop: 10 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="6-digit code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  style={{ marginRight: 8, padding: '6px 10px', width: 120 }}
                />
                <button className="btn-primary" onClick={confirmEnroll} disabled={busy || code.length !== 6}>
                  {busy ? 'Confirming…' : 'Confirm'}
                </button>
                <button
                  className="btn-secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => { setEnrollStep('idle'); setError(null); setCode(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {enrollStep === 'backup-codes' && backupCodes && (
            <div>
              <p className="lede" style={{ fontSize: 13, marginBottom: 12 }}>
                Save these backup codes somewhere safe. Each works once, if you lose access to your
                authenticator app. They will not be shown again.
              </p>
              <DataTable
                columns={['Backup code']}
                rows={backupCodes.map((c) => [<Mono key={c}>{c}</Mono>])}
              />
              <button className="btn-primary" style={{ marginTop: 14 }} onClick={finishEnrollment}>
                I've saved these codes
              </button>
            </div>
          )}
        </Panel>

        <Panel
          title="Active sessions"
          label={sessions ? `${sessions.length} active` : undefined}
          actions={
            sessions && sessions.length > 1 ? (
              <button className="btn-secondary btn-sm" onClick={revokeAllOthers}>Sign out other sessions</button>
            ) : undefined
          }
        >
          {!sessions && <p className="lede" style={{ fontSize: 13 }}>Loading…</p>}
          {sessions && (
            <DataTable
              columns={['Device', 'IP', 'Last active', '']}
              rows={sessions.map((s) => [
                <span key={`d${s.id}`}>
                  {browserFromUA(s.userAgent)} {s.current && <Pill tone="ok">this device</Pill>}
                </span>,
                <Mono key={`i${s.id}`}>{s.ipAddress ?? '—'}</Mono>,
                <span key={`t${s.id}`}>{timeAgo(s.lastSeenAt)}</span>,
                s.current ? (
                  <span key={`r${s.id}`} />
                ) : (
                  <button key={`r${s.id}`} className="btn-secondary btn-sm" onClick={() => revokeOne(s.id)}>
                    Sign out
                  </button>
                ),
              ])}
            />
          )}
        </Panel>
      </Grid2>
    </>
  );
}
