'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export default function LoginForm() {
  const router = useRouter();
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [showPass,  setShowPass]  = useState(false);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      // LAUNCH BLOCKER: this is a fake 800ms delay — no real authentication happens.
      // Replace with:
      //   import { signIn } from 'next-auth/react';
      //   const result = await signIn('credentials', { email, password, redirect: false });
      //   if (result?.error) throw new Error(result.error);
      //   router.push('/');
      // You also need src/app/api/auth/[...nextauth]/route.ts with a CredentialsProvider
      // that validates against the merchants table and returns a JWT with the API key.
      await new Promise((r) => setTimeout(r, 800));
      router.push('/');
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2.5">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          required
          className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1.5">Password</label>
        <div className="relative">
          <input
            type={showPass ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            required
            className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 pr-10 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20 transition-colors"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            onClick={() => setShowPass(!showPass)}
          >
            {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-navy-800 font-bold py-2.5 rounded-lg text-sm transition-colors"
      >
        {loading && <Loader2 size={14} className="animate-spin" />}
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
