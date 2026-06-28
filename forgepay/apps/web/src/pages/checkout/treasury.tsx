'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export default function TreasuryCheckout() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: 'treasury', plan: 'standard' }),
      });

      const data = await response.json();
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
      else if (data.authenticated) router.push('/dashboard/onboarding/treasury');
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        <h1 className="text-3xl font-bold mb-2">FORGE Treasury</h1>
        <p className="text-gray-600 mb-8">Automate cash netting and multi-currency settlements</p>

        <div className="mb-8 p-6 bg-gray-50 rounded-lg">
          <div className="text-5xl font-bold text-green-600 mb-2">R40K</div>
          <div className="text-gray-600">/month</div>
          <p className="text-sm text-gray-500 mt-2">14-day free trial included</p>
        </div>

        <ul className="space-y-4 mb-8 text-sm text-gray-700">
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>Automatic daily netting settlements</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>OFAC/KYC screening included</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>Multi-asset support (USDC, USDT, stablecoins)</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>Real-time FX conversion</span>
          </li>
        </ul>

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
        >
          {loading ? 'Starting...' : 'Start Free Trial'}
        </button>
      </div>
    </div>
  );
}
