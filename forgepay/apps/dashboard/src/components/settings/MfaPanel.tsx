'use client';

import { useState, useEffect } from 'react';
import { ShieldCheck, ShieldOff, Loader2, Copy, Check, AlertTriangle } from 'lucide-react';

/**
 * Two-factor authentication.
 *
 * Enrollment is deliberately two-step — staging a factor does not turn MFA
 * on; confirming a real code does. So a merchant who scans nothing, or scans
 * into the wrong app, is never locked out of their own account.
 *
 * The backup codes are shown exactly once, here, at the moment they are
 * generated: only their hashes are stored, so there is no later screen that
 * could show them again.
 */

interface MfaStatus {
  enabled: boolean;
  enrollmentStaged: boolean;
  backupCodesRemaining: number;
  available: boolean;
}

interface Enrollment {
  qrCode: string;
  secret: string;
  backupCodes: string[];
}

export default function MfaPanel() {
  const [status,     setStatus]     = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code,       setCode]       = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disabling,  setDisabling]  = useState(false);
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState('');
  const [copied,     setCopied]     = useState(false);

  useEffect(() => { void refresh(); }, []);

  async function refresh() {
    try {
      const res = await fetch('/api/mfa');
      if (res.ok) setStatus(await res.json());
    } catch {
      setError('Could not load two-factor status.');
    }
  }

  async function startEnrollment() {
    setBusy(true);
    setError('');
    try {
      const res  = await fetch('/api/mfa/enroll', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Enrollment failed');
      setEnrollment(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res  = await fetch('/api/mfa/verify-enrollment', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'That code is not valid.');

      setEnrollment(null);
      setCode('');
      await refresh();
    } catch (err) {
      setCode('');
      setError(err instanceof Error ? err.message : 'That code is not valid.');
    } finally {
      setBusy(false);
    }
  }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // A 6-digit value is a TOTP code; anything else is treated as a backup
      // code, so a merchant who has lost their authenticator can still get out.
      const isTotp = /^\d{6}$/.test(disableCode.trim());
      const res = await fetch('/api/mfa', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(isTotp ? { code: disableCode } : { backupCode: disableCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? 'Could not disable two-factor authentication.');

      setDisabling(false);
      setDisableCode('');
      await refresh();
    } catch (err) {
      setDisableCode('');
      setError(err instanceof Error ? err.message : 'Could not disable two-factor authentication.');
    } finally {
      setBusy(false);
    }
  }

  function copyBackupCodes() {
    if (!enrollment) return;
    void navigator.clipboard.writeText(enrollment.backupCodes.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  if (!status.available) {
    return (
      <p className="text-xs text-gray-500">
        Two-factor authentication is not configured for this deployment.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2.5">
          {error}
        </div>
      )}

      {/* ── Enrolling ─────────────────────────────────────────────────────── */}
      {enrollment ? (
        <div className="space-y-5">
          <div>
            <p className="text-sm text-white mb-1">Scan this with your authenticator app</p>
            <p className="text-xs text-gray-500 mb-3">
              Google Authenticator, 1Password, Authy — any TOTP app works.
            </p>
            {/* WorkOS returns a data URL; tolerate a bare base64 payload too. */}
            <img
              src={enrollment.qrCode.startsWith('data:') ? enrollment.qrCode : `data:image/png;base64,${enrollment.qrCode}`}
              alt="Two-factor authentication QR code"
              className="w-40 h-40 rounded-lg bg-white p-2"
            />
            <div className="mt-3">
              <div className="text-xs text-gray-400 mb-1">Or enter this key manually</div>
              <code className="block bg-navy-900/60 border border-white/10 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono break-all">
                {enrollment.secret}
              </code>
            </div>
          </div>

          <div className="bg-amber-500/[0.07] border border-amber-500/25 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-amber-400" />
              <span className="text-sm font-semibold text-amber-300">Save your backup codes</span>
            </div>
            <p className="text-xs text-gray-400 mb-3">
              Each works once, if you lose your authenticator. This is the only time they are shown.
            </p>
            <div className="grid grid-cols-2 gap-1.5 mb-3">
              {enrollment.backupCodes.map((c) => (
                <code key={c} className="bg-navy-900/60 border border-white/10 rounded px-2 py-1.5 text-xs text-gray-300 font-mono text-center">
                  {c}
                </code>
              ))}
            </div>
            <button
              type="button"
              onClick={copyBackupCodes}
              className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy all'}
            </button>
          </div>

          <form onSubmit={confirmEnrollment} className="space-y-3">
            <div>
              <label htmlFor="mfa-confirm" className="block text-xs text-gray-400 mb-1.5">
                Enter the 6-digit code to finish
              </label>
              <input
                id="mfa-confirm"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="000000"
                required
                autoFocus
                inputMode="numeric"
                maxLength={6}
                autoComplete="one-time-code"
                className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 font-mono tracking-widest focus:outline-none focus:border-cyan-500/50 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-navy-800 font-bold px-4 py-2 rounded-lg text-sm transition-colors"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                Turn on
              </button>
              <button
                type="button"
                onClick={() => { setEnrollment(null); setCode(''); setError(''); }}
                className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-gray-500">
              Turning this on signs you out on every other device.
            </p>
          </form>
        </div>

      /* ── Enabled ───────────────────────────────────────────────────────── */
      ) : status.enabled ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck size={15} className="text-emerald-400" />
            <span className="text-sm text-white">Two-factor authentication is on</span>
          </div>
          <p className="text-xs text-gray-500">
            {status.backupCodesRemaining > 0
              ? `${status.backupCodesRemaining} backup code${status.backupCodesRemaining === 1 ? '' : 's'} remaining.`
              : 'No backup codes remaining — turn two-factor off and on again to generate a new set.'}
          </p>

          {disabling ? (
            <form onSubmit={disable} className="space-y-3 pt-1">
              <div>
                <label htmlFor="mfa-disable" className="block text-xs text-gray-400 mb-1.5">
                  Enter a current code or a backup code to confirm
                </label>
                <input
                  id="mfa-disable"
                  type="text"
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value)}
                  placeholder="000000"
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 font-mono tracking-widest focus:outline-none focus:border-red-500/50 transition-colors"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex items-center gap-2 bg-red-500/90 hover:bg-red-500 disabled:opacity-50 text-white font-bold px-4 py-2 rounded-lg text-sm transition-colors"
                >
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  Turn off
                </button>
                <button
                  type="button"
                  onClick={() => { setDisabling(false); setDisableCode(''); setError(''); }}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setDisabling(true)}
              className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              <ShieldOff size={14} />
              Turn off two-factor authentication
            </button>
          )}
        </div>

      /* ── Off ───────────────────────────────────────────────────────────── */
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            Require a code from your authenticator app in addition to your password.
          </p>
          <button
            type="button"
            onClick={startEnrollment}
            disabled={busy}
            className="flex items-center gap-2 bg-white/[0.03] hover:bg-white/[0.06] disabled:opacity-50 border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white transition-colors"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
            Enable two-factor authentication
          </button>
        </div>
      )}
    </div>
  );
}
