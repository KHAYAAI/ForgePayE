import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@/context/AuthContext';
import { useWallet } from '@/hooks/useWallet';
import Link from 'next/link';

export default function Dashboard() {
  const router = useRouter();
  const { user, loading: authLoading, logout } = useAuth();
  const { wallet, balance, createWallet, loading: walletLoading } = useWallet();
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, authLoading, router]);

  const handleCreateWallet = async () => {
    setCreating(true);
    try {
      await createWallet('ethereum');
    } catch (err) {
      console.error('Failed to create wallet:', err);
    } finally {
      setCreating(false);
    }
  };

  if (authLoading || walletLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-blue-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">OpenPrivy</h1>
            <p className="text-sm text-gray-600">{user?.email}</p>
          </div>
          <button
            onClick={logout}
            className="px-4 py-2 text-gray-600 hover:text-gray-900 font-medium transition"
          >
            Logout
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="grid md:grid-cols-3 gap-6">
          {/* Wallet Card */}
          <div className="bg-white rounded-lg shadow-md p-6 col-span-1">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Wallet</h2>

            {wallet ? (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600">Address</p>
                  <p className="font-mono text-sm break-all text-gray-900">
                    {wallet.address}
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-600">Balance</p>
                  <p className="text-2xl font-bold text-purple-600">
                    {parseFloat(balance).toFixed(4)} ETH
                  </p>
                </div>

                <div>
                  <p className="text-sm text-gray-600">Network</p>
                  <p className="text-gray-900 font-medium">Ethereum (Sepolia)</p>
                </div>

                <div className="pt-4 border-t">
                  <Link
                    href="/wallet/send"
                    className="w-full inline-block text-center bg-purple-600 text-white py-2 rounded-lg font-semibold hover:bg-purple-700 transition"
                  >
                    Send Transaction
                  </Link>
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-gray-600 mb-4">No wallet yet. Create one to get started.</p>
                <button
                  onClick={handleCreateWallet}
                  disabled={creating}
                  className="w-full bg-purple-600 text-white py-2 rounded-lg font-semibold hover:bg-purple-700 disabled:bg-gray-400 transition"
                >
                  {creating ? 'Creating...' : 'Create Wallet'}
                </button>
              </div>
            )}
          </div>

          {/* Info Cards */}
          <div className="col-span-2 space-y-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Getting Started</h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-semibold">
                    ✓
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Create a wallet</p>
                    <p className="text-gray-600">Your embedded wallet is created with no seed phrase</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-semibold">
                    2
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Get testnet tokens</p>
                    <p className="text-gray-600">Use our faucet to get free Sepolia ETH</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center font-semibold">
                    3
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">Send your first transaction</p>
                    <p className="text-gray-600">Sign and send transactions in seconds</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Security</h3>
              <div className="space-y-3 text-sm">
                <p className="text-gray-700">
                  Your private key is encrypted and stored securely. No seed phrases needed.
                </p>
                <Link
                  href="/security"
                  className="inline-block text-purple-600 hover:underline font-medium"
                >
                  Manage security settings →
                </Link>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="mt-8 grid md:grid-cols-3 gap-6">
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-3xl font-bold text-purple-600">1</p>
            <p className="text-gray-600 mt-2">Wallet Created</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-3xl font-bold text-purple-600">0</p>
            <p className="text-gray-600 mt-2">Transactions</p>
          </div>
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <p className="text-3xl font-bold text-purple-600">Secure</p>
            <p className="text-gray-600 mt-2">Account Status</p>
          </div>
        </div>
      </div>
    </div>
  );
}
