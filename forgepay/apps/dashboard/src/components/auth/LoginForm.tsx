'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signIn } from 'next-auth/react';
import { Eye, EyeOff, Loader2, Building2, KeyRound } from 'lucide-react';

/**
 * Three ways in, one form:
 *
 *   password        → email + password
 *   password + MFA  → the above, then a TOTP or backup code
 *   SSO             → redirect to the org's IdP, return with a ticket
 *
 * The MFA step exists because authorize() refuses to mint a session for an
 * MFA-enabled merchant on a password alone. It signals that by throwing
 * MFA_REQUIRED, which arrives here as `result.error` — that string is the
 * only thing distinguishing "password was right, now prove the second
 * factor" from "those credentials are wrong", so it drives the stage.
 */

/** Callback failure reasons (set by /api/auth/sso/callback) rendered as prose. */
const SSO_ERRORS: Record<string, string> = {
  sso_missing_code:         'Your identity provider did not complete the sign-in. Please try again.',
  sso_state_mismatch:       'That sign-in link has expired or was already used. Please try again.',
  sso_provisioning_failed:  'We could not set up your account. Contact support if this continues.',
  sso_failed:               'Single sign-on failed. Please try again or use your password.',
};

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [stage,      setStage]      = useState<'credentials' | 'mfa'>('credentials');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [code,       setCode]       = useState('');
  const [useBackup,  setUseBackup]  = useState(false);
  const [showPass,   setShowPass]   = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [ssoLoading, setSsoLoading] = useState(false);
  const [error,      setError]      = useState('');
  const [notice,     setNotice]     = useState('');

  const finish = useCallback(() => {
    router.push('/');
    router.refresh();
  }, [router]);

  // ── Returning from the IdP ────────────────────────────────────────────────
  // The callback redirects here with a single-use ticket. Spend it through the
  // ordinary credentials flow (that provider is the only thing that can mint a
  // session), then strip it from the URL so a refresh doesn't retry a ticket
  // that is already spent — and so it stops sitting in browser history.
  const ssoTicket = searchParams?.get('sso_ticket') ?? null;
  const ssoError  = searchParams?.get('error') ?? null;

  useEffect(() => {
    if (!ssoTicket) return;

    let cancelled = false;
    setLoading(true);
    router.replace('/login');

    signIn('credentials', { ssoTicket, redirect: false })
      .then((result) => {
        if (cancelled) return;
        if (result?.error) {
          setError('That sign-in link has expired. Please sign in again.');
          setLoading(false);
          return;
        }
        finish();
      })
      .catch(() => {
        if (cancelled) return;
        setError('Sign-in failed. Please try again.');
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [ssoTicket, router, finish]);

  useEffect(() => {
    if (ssoError) {
      setError(SSO_ERRORS[ssoError] ?? 'Sign-in failed. Please try again.');
      router.replace('/login');
    }
  }, [ssoError, router]);

  // ── Password (and MFA) ────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');

    const result = await signIn('credentials', {
      email,
      password,
      // Only one of these is ever populated; authorize() prefers the backup code.
      ...(stage === 'mfa' && !useBackup ? { totpCode:   code } : {}),
      ...(stage === 'mfa' &&  useBackup ? { backupCode: code } : {}),
      redirect: false,
    });

    if (!result?.error) {
      finish();
      return;
    }

    setLoading(false);

    switch (result.error) {
      case 'MFA_REQUIRED':
        // Password was correct — ask for the second factor. Not an error state.
        setStage('mfa');
        setCode('');
        setNotice('Enter the 6-digit code from your authenticator app.');
        break;
      case 'MFA_INVALID':
        setCode('');
        setError(useBackup ? 'That backup code is not valid.' : 'That code is not valid. Codes expire every 30 seconds.');
        break;
      default:
        // Everything else collapses to one message on purpose: distinguishing
        // "no such account" from "wrong password" tells an attacker which
        // addresses are real.
        setStage('credentials');
        setError('Invalid email or password.');
    }
  }

  // ── SSO ───────────────────────────────────────────────────────────────────
  async function handleSso() {
    if (!email) {
      setError('Enter your work email first, then choose single sign-on.');
      return;
    }
    setSsoLoading(true);
    setError('');
    setNotice('');

    try {
      const res  = await fetch('/api/auth/sso/authorize', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      });
      const data = await res.json();

      if (!res.ok) throw new Error(data?.error ?? 'SSO failed');

      if (!data.ssoAvailable) {
        setNotice('Single sign-on is not set up for that email domain. Use your password instead.');
        setSsoLoading(false);
        return;
      }

      // Full navigation, not a router push — the IdP is a different origin.
      window.location.href = data.ssoUrl;
    } catch {
      setError('Could not start single sign-on. Please try again.');
      setSsoLoading(false);
    }
  }

  const busy = loading || ssoLoading;

  // Spending a returning ticket: nothing to fill in, so don't show a form.
  if (ssoTicket && loading) {
    return (
      <div className="flex flex-col items-center gap-3 py-6">
        <Loader2 size={20} className="animate-spin text-cyan-400" />
        <p className="text-sm text-gray-400">Completing sign-in…</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2.5">
          {error}
        </div>
      )}
      {notice && !error && (
        <div className="bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-sm rounded-lg px-4 py-2.5">
          {notice}
        </div>
      )}

      {stage === 'credentials' ? (
        <>
          <div>
            <label htmlFor="email" className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              autoComplete="email"
              className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
            <div className="relative">
              <input
                id="password"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete="current-password"
                className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
              />
              <button
                type="button"
                aria-label={showPass ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                onClick={() => setShowPass(!showPass)}
              >
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div>
          <label htmlFor="code" className="block text-xs font-medium text-gray-400 mb-1.5">
            {useBackup ? 'Backup code' : 'Authentication code'}
          </label>
          <input
            id="code"
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={useBackup ? 'a1b2c3d4e5' : '000000'}
            required
            autoFocus
            autoComplete="one-time-code"
            inputMode={useBackup ? 'text' : 'numeric'}
            maxLength={useBackup ? 10 : 6}
            className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 font-mono tracking-widest focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
          />
          <div className="flex items-center justify-between mt-2">
            <button
              type="button"
              onClick={() => { setUseBackup(!useBackup); setCode(''); setError(''); }}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              {useBackup ? 'Use authenticator app' : 'Use a backup code'}
            </button>
            <button
              type="button"
              onClick={() => { setStage('credentials'); setCode(''); setError(''); setNotice(''); setUseBackup(false); }}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Back
            </button>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={busy}
        className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-navy-800 font-bold py-2.5 rounded-lg text-sm transition-colors"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading ? 'Signing in…' : stage === 'mfa' ? 'Verify' : 'Sign in'}
      </button>

      {stage === 'credentials' && (
        <>
          <div className="flex items-center gap-3 pt-1">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-[11px] uppercase tracking-wider text-gray-600">or</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <button
            type="button"
            onClick={handleSso}
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-white/[0.03] hover:bg-white/[0.07] disabled:opacity-50 border border-white/10 text-white font-medium py-2.5 rounded-lg text-sm transition-colors"
          >
            {ssoLoading ? <Loader2 size={14} className="animate-spin" /> : <Building2 size={14} />}
            {ssoLoading ? 'Redirecting…' : 'Sign in with SSO'}
          </button>

          <p className="flex items-center justify-center gap-1.5 text-[11px] text-gray-600">
            <KeyRound size={11} />
            Uses your company&apos;s identity provider
          </p>
        </>
      )}
    </form>
  );
}
