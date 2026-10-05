'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/* FORGE editorial auth screen — paper/ink design system (globals.css).
   Mirrors /auth/login's split layout so the two form a matched pair. */

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

export default function SignupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    company: '',
  });

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Signup failed');
      }

      // Nothing is enabled for a new tenant yet — send them to pick products
      // rather than assuming Payments (or anything else) is what they want.
      router.push('/dashboard/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
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
        <h1 style={{ fontWeight: 500, fontSize: 'clamp(38px, 4.6vw, 64px)', lineHeight: 0.94, letterSpacing: -2, marginTop: 'auto', maxWidth: '15ch' }}>
          One sign-up. <em style={{ fontStyle: 'italic', fontWeight: 300 }}>Six platforms.</em>
        </h1>
        <p style={{ color: 'rgba(244,242,238,0.72)', fontSize: 15.5, lineHeight: 1.55, maxWidth: '44ch', marginTop: 20 }}>
          Land with payments. Expand into custody, wallets, agent credit and treasury — same login, same ledger.
        </p>
        <div style={{ marginTop: 'clamp(32px, 5vw, 56px)', paddingTop: 22, borderTop: '1px solid rgba(244,242,238,0.2)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
          {[
            ['14 days', 'Free trial, no card'],
            ['R0/mo', 'Payments platform fee'],
            ['2 min', 'To connect an agent'],
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
            <span className="mono">Create your account</span>
            <span style={{ width: 24, height: 1, background: 'var(--steel)' }} />
            <span className="mono">myforgepay.com</span>
          </div>

          <h2 style={{ fontSize: 'clamp(26px, 3vw, 34px)', fontWeight: 500, letterSpacing: -0.8, lineHeight: 1.02, marginBottom: 6 }}>
            Join <em style={{ fontStyle: 'italic', fontWeight: 300 }}>FORGE</em>.
          </h2>
          <p style={{ fontSize: 13.5, color: 'var(--steel)', marginBottom: 24 }}>Start your 14-day free trial. No card needed.</p>

          {error && (
            <div style={{ border: '1px solid var(--danger)', color: 'var(--danger)', padding: '11px 13px', marginBottom: 18, fontSize: 13 }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={label}>Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={input}
                placeholder="Your name"
                autoComplete="name"
                required
              />
            </div>

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
              <label style={label}>Company · optional</label>
              <input
                type="text"
                value={formData.company}
                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                style={input}
                placeholder="Your company"
                autoComplete="organization"
              />
            </div>

            <div>
              <label style={label}>Password</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                style={input}
                placeholder="Min. 8 characters"
                autoComplete="new-password"
                minLength={8}
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
              {loading ? 'Creating account…' : 'Create account →'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 20, color: 'var(--steel)', fontSize: 12.5 }}>
            Already have an account?{' '}
            <Link href="/auth/login" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--ink)' }}>
              Sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
