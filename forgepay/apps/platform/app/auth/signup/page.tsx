'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

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

      // Redirect to dashboard
      router.push('/dashboard/payments');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Signup failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)', padding: 40 }}>
      <div style={{ background: 'white', borderRadius: 12, padding: 40, maxWidth: 400, width: '100%', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)' }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: 'var(--navy)' }}>
          Forge<span style={{ color: 'var(--cyan)' }}>Pay</span>
        </h1>
        <p style={{ color: 'var(--text-light)', marginBottom: 32 }}>Create your account</p>

        {error && (
          <div style={{ background: '#FFF5F5', border: '1px solid #FF6B6B', color: '#FF6B6B', padding: 12, borderRadius: 8, marginBottom: 24, fontSize: 14 }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #eee', borderRadius: 6, fontSize: 14 }}
              placeholder="Your name"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #eee', borderRadius: 6, fontSize: 14 }}
              placeholder="your@email.com"
              required
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Company (optional)</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #eee', borderRadius: 6, fontSize: 14 }}
              placeholder="Your company"
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600, fontSize: 14 }}>Password</label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              style={{ width: '100%', padding: '10px 12px', border: '1px solid #eee', borderRadius: 6, fontSize: 14 }}
              placeholder="Min. 8 characters"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            style={{
              padding: '12px 24px',
              background: loading ? '#ccc' : 'linear-gradient(135deg, var(--navy) 0%, var(--dark-blue) 100%)',
              color: 'white',
              borderRadius: 6,
              border: 'none',
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              marginTop: 8,
            }}
          >
            {loading ? '...' : 'Create Account'}
          </button>
        </form>

        <p style={{ textAlign: 'center', marginTop: 24, color: 'var(--text-light)', fontSize: 14 }}>
          Already have an account?{' '}
          <Link href="/auth/login" style={{ color: 'var(--cyan)', fontWeight: 600, textDecoration: 'none' }}>
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
