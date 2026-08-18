'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/* FORGE editorial auth screen — paper/ink design system (globals.css).
   Split layout: ink statement panel + paper form, matching the marketing
   site's hero/statement language. */

const label: React.CSSProperties = {
  display: 'block',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 9.5,
  letterSpacing: 1.4,
  textTransform: 'uppercase',
  color: 'var(--steel)',
  marginBottom: 7,
};

const input: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--hair)',
  background: 'var(--paper)',
  padding: '12px 13px',
  fontSize: 14,
  color: 'var(--ink)',
  borderRadius: 0,
  fontFamily: 'inherit',
};

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState('');
  const [ssoRequired, setSsoRequired] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSsoRequired(false);

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.ssoRequired) setSsoRequired(true);
        throw new Error(data.error || 'Sign-in failed');
      }

      if (data.mfaRequired) {
        setMfaStep(true);
        return;
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/mfa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: mfaCode }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Invalid code');
      }

      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1fr)' }} className="auth-split">
      <style>{`
        @media (max-width: 860px) { .auth-split { grid-template-columns: 1fr !important; } .auth-aside { display: none !important; } }
      `}</style>

      {/* Ink statement panel */}
      <aside className="auth-aside" style={{ background: 'var(--ink)', color: 'var(--paper)', padding: 'clamp(32px, 4vw, 56px)', display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15, letterSpacing: 3 }}>FORGE</span>
        <h1 style={{ fontWeight: 500, fontSize: 'clamp(38px, 4.6vw, 64px)', lineHeight: 0.94, letterSpacing: -2, marginTop: 'auto', maxWidth: '14ch' }}>
          Every form of <em style={{ fontStyle: 'italic', fontWeight: 300 }}>value.</em> One console.
        </h1>
        <p style={{ color: 'rgba(244,242,238,0.72)', fontSize: 15.5, lineHeight: 1.55, maxWidth: '44ch', marginTop: 20 }}>
          Payments, agent credit, treasury and custody behind a single sign-in.
        </p>
        <div style={{ marginTop: 'clamp(32px, 5vw, 56px)', paddingTop: 22, borderTop: '1px solid rgba(244,242,238,0.2)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            ['0–1000', 'Agent credit score'],
            ['$2.80', 'Per score inquiry'],
            ['99.7%', 'Payment success'],
          ].map(([v, k]) => (
            <div key={k}>
              <div style={{ fontSize: 'clamp(19px, 2vw, 26px)', fontWeight: 500, letterSpacing: -0.4 }}>{v}</div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: 1.4, textTransform: 'uppercase', color: 'rgba(244,242,238,0.5)', marginTop: 5 }}>{k}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* Paper form panel */}
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '44px 26px', background: 'var(--paper)' }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
            <span className="mono">Console access</span>
            <span style={{ width: 24, height: 1, background: 'var(--steel)' }} />
            <span className="mono">forgepay.io</span>
          </div>

          <h2 style={{ fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 500, letterSpacing: -0.8, lineHeight: 1.02, marginBottom: 6 }}>
            {mfaStep ? (
              <>Two-<em style={{ fontStyle: 'italic', fontWeight: 300 }}>factor</em>.</>
            ) : (
              <>Welcome <em style={{ fontStyle: 'italic', fontWeight: 300 }}>back</em>.</>
            )}
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--steel)', marginBottom: 24 }}>
            {mfaStep
              ? 'Enter the 6-digit code from your authenticator app, or a backup code.'
              : 'Sign in to the FORGE console.'}
          </p>

          {error && (
            <div style={{ border: '1px solid var(--danger)', color: 'var(--danger)', padding: '11px 13px', marginBottom: 18, fontSize: 13 }}>
              {error}
              {ssoRequired && (
                <>
                  {' '}
                  <Link href={`/auth/sso?email=${encodeURIComponent(formData.email)}`} style={{ color: 'var(--danger)', textDecoration: 'underline' }}>
                    Continue with SSO →
                  </Link>
                </>
              )}
            </div>
          )}

          {!mfaStep && (
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={label}>Work email</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  style={input}
                  placeholder="you@company.com"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label style={label}>Password</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  style={input}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  padding: '13px 20px',
                  border: '1px solid var(--ink)',
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                  marginTop: 8,
                }}
              >
                {loading ? 'Signing in…' : 'Sign in →'}
              </button>
            </form>
          )}

          {mfaStep && (
            <form onSubmit={handleMfaSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={label}>Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value.trim())}
                  style={input}
                  placeholder="123456"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading || mfaCode.length < 6}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 2,
                  textTransform: 'uppercase',
                  padding: '13px 20px',
                  border: '1px solid var(--ink)',
                  background: 'var(--ink)',
                  color: 'var(--paper)',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.5 : 1,
                  marginTop: 8,
                }}
              >
                {loading ? 'Verifying…' : 'Verify →'}
              </button>

              <button
                type="button"
                onClick={() => { setMfaStep(false); setMfaCode(''); setError(''); }}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 11,
                  letterSpacing: 1.4,
                  color: 'var(--steel)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                ← Back to sign in
              </button>
            </form>
          )}

          {!mfaStep && (
            <>
              <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--steel)', fontSize: 12.5 }}>
                New to FORGE?{' '}
                <Link href="/auth/signup" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>
                  Create an account
                </Link>
              </p>
              <p style={{ textAlign: 'center', marginTop: 10, color: 'var(--steel)', fontSize: 12.5 }}>
                <Link href="/auth/sso" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>
                  Sign in with SSO instead
                </Link>
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
