import { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import Link from 'next/link';

export default function Home() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.push('/dashboard');
      }
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-blue-900">
      <div className="flex flex-col items-center justify-center min-h-screen px-4">
        <div className="text-center">
          <h1 className="text-5xl font-bold text-white mb-4">OpenPrivy</h1>
          <p className="text-xl text-purple-200 mb-8">
            Web3 wallet for Africa. No seed phrases. Simple auth.
          </p>

          <div className="space-y-3 mb-8">
            <p className="text-gray-300">Embedded wallets • Gas sponsorship • Multi-chain</p>
            <p className="text-gray-300">Account abstraction • Email login • Mobile-first</p>
          </div>

          <div className="flex gap-4 justify-center flex-wrap">
            <Link
              href="/auth/login"
              className="px-8 py-3 bg-white text-purple-900 rounded-lg font-semibold hover:bg-gray-100 transition"
            >
              Sign In
            </Link>
            <Link
              href="/auth/signup"
              className="px-8 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition border border-purple-500"
            >
              Get Started
            </Link>
          </div>

          <div className="mt-12 text-gray-400 text-sm">
            <p>Phase 0 MVP • Built with TypeScript, React, ethers.js • Open source</p>
          </div>
        </div>
      </div>
    </div>
  );
}
