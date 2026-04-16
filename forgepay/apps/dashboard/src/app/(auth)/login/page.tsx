import type { Metadata } from 'next';
import Link from 'next/link';
import LoginForm from '@/components/auth/LoginForm';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center px-4">
      {/* Background grid */}
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#00F0FF 1px,transparent 1px),linear-gradient(90deg,#00F0FF 1px,transparent 1px)',
          backgroundSize: '50px 50px',
        }}
      />

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <span className="text-2xl font-black text-white">⚡ ForgePay</span>
          <p className="text-sm text-gray-400 mt-1">Sign in to your dashboard</p>
        </div>

        {/* Form card */}
        <div className="card p-8">
          <LoginForm />
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          No account?{' '}
          <Link href="/signup" className="text-cyan-400 hover:text-cyan-300">
            Create one free
          </Link>
        </p>
      </div>
    </div>
  );
}
