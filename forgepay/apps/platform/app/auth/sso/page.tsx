'use client';

import { FormEvent, Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/* FORGE — SSO entry point. Mirrors app/auth/login/page.tsx's paper/ink
   layout. Purely a redirect: submitting takes the browser to
   GET /api/auth/sso/authorize, which looks up the org and bounces to the
   enterprise's own IdP via WorkOS. */

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

export default function SsoLoginPage() {
  return (
    <Suspense fallback={null}>
      <SsoLoginForm />
    </Suspense>
  );
}

function SsoLoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [loading, setLoading] = useState(false);
  const error = params.get('error');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    window.location.href = `/api/auth/sso/authorize?email=${encodeURIComponent(email)}`;
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '44px 26px', background: 'var(--paper)' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 22 }}>
          <span className="mono">Console access</span>
          <span style={{ width: 24, height: 1, background: 'var(--steel)' }} />
          <span className="mono">forgepay.io</span>
        </div>

        <h2 style={{ fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 500, letterSpacing: -0.8, lineHeight: 1.02, marginBottom: 6 }}>
          Sign in with <em style={{ fontStyle: 'italic', fontWeight: 300 }}>SSO</em>.
        </h2>
        <p style={{ fontSize: 13.5, color: 'var(--steel)', marginBottom: 24 }}>
          Enter your work email — we'll route you to your organization's identity provider.
        </p>

        {error && (
          <div style={{ border: '1px solid var(--danger)', color: 'var(--danger)', padding: '11px 13px', marginBottom: 18, fontSize: 13 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={label}>Work email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={input}
              placeholder="you@company.com"
              autoComplete="email"
              autoFocus
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
            {loading ? 'Redirecting…' : 'Continue →'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--steel)', fontSize: 12.5 }}>
          <Link href="/auth/login" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>
            Sign in with a password instead
          </Link>
        </p>
      </div>
    </div>
  );
}
