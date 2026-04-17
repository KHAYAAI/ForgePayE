import type { Metadata } from 'next';
import Link from 'next/link';
import SignupForm from '@/components/auth/SignupForm';

export const metadata: Metadata = { title: 'Create account' };

export default function SignupPage() {
  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center px-4">
      <div
        className="fixed inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#00F0FF 1px,transparent 1px),linear-gradient(90deg,#00F0FF 1px,transparent 1px)',
          backgroundSize: '50px 50px',
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="text-center mb-8">
          <span className="text-2xl font-black text-white">⚡ ForgePay</span>
          <p className="text-sm text-gray-400 mt-1">Create your merchant account</p>
        </div>

        <div className="card p-8">
          <SignupForm />
        </div>

        <p className="text-center text-xs text-gray-500 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-cyan-400 hover:text-cyan-300">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
