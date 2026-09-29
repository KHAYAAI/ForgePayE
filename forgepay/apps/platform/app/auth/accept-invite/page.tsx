'use client';

import { FormEvent, Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

const label: React.CSSProperties = {
  display: 'block', fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: 1.4,
  textTransform: 'uppercase', color: 'var(--steel)', marginBottom: 7,
};
const input: React.CSSProperties = {
  width: '100%', border: '1px solid var(--hair)', background: 'var(--paper)', padding: '12px 13px',
  fontSize: 14, color: 'var(--ink)', borderRadius: 0, fontFamily: 'inherit',
};

interface Invite { email: string; role: string; workspace: string }

function AcceptInvite() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [invite, setInvite] = useState<Invite | null>(null);
  const [invalid, setInvalid] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/invite?token=${encodeURIComponent(token)}`)
      .then(async (r) => (r.ok ? setInvite((await r.json()).data) : setInvalid((await r.json()).error)))
      .catch(() => setInvalid('Could not check this invitation.'));
  }, [token]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await fetch('/api/auth/accept-invite', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name, password }),
    });
    if (res.ok) {
      router.push('/dashboard');
      return;
    }
    setError((await res.json().catch(() => null))?.error ?? 'Could not accept the invitation.');
    setBusy(false);
  }

  return (
    <main style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '44px 26px', background: 'var(--paper)' }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, fontSize: 15, letterSpacing: 3 }}>FORGE</span>
        {invalid ? (
          <>
            <h1 style={{ fontSize: 30, fontWeight: 500, letterSpacing: -0.8, margin: '28px 0 10px' }}>Invitation <em style={{ fontWeight: 300 }}>unavailable</em></h1>
            <p style={{ color: 'var(--steel)', fontSize: 14 }}>{invalid} Ask whoever invited you to send a new one.</p>
          </>
        ) : !invite ? (
          <p style={{ marginTop: 28, color: 'var(--steel)' }}>Checking your invitation…</p>
        ) : (
          <>
            <h1 style={{ fontSize: 30, fontWeight: 500, letterSpacing: -0.8, margin: '28px 0 10px' }}>Join <em style={{ fontWeight: 300 }}>{invite.workspace}</em></h1>
            <p style={{ color: 'var(--steel)', fontSize: 14, marginBottom: 24 }}>
              You've been invited as <strong style={{ color: 'var(--ink)' }}>{invite.role}</strong>. Choose a password to create your account.
            </p>
            {error && <div style={{ border: '1px solid var(--danger)', color: 'var(--danger)', padding: '11px 13px', marginBottom: 18, fontSize: 13 }}>{error}</div>}
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div><label style={label}>Email</label><input style={{ ...input, opacity: 0.7 }} value={invite.email} readOnly /></div>
              <div><label style={label}>Your name</label><input style={input} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required minLength={2} /></div>
              <div><label style={label}>Password</label><input style={input} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" placeholder="Min. 8 characters" required minLength={8} /></div>
              <button className="btn-primary" type="submit" disabled={busy}>{busy ? 'Joining…' : 'Accept invitation →'}</button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

export default function AcceptInvitePage() {
  return <Suspense fallback={null}><AcceptInvite /></Suspense>;
}
