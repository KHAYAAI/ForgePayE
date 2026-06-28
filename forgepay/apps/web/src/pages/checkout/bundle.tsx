'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export default function BundleCheckout() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const products = searchParams.get('products') || 'treasury,credit-bureau';
  const [loading, setLoading] = useState(false);

  const isTreasuryAndCB = products === 'treasury,credit-bureau';
  const savings = isTreasuryAndCB ? 3500 : 0;
  const bundlePrice = isTreasuryAndCB ? 45000 : 0;

  const handleCheckout = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: 'bundle', plan: 'standard', items: products.split(',') }),
      });

      const data = await response.json();
      if (data.checkoutUrl) window.location.href = data.checkoutUrl;
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 to-purple-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        <div className="mb-4 inline-block px-3 py-1 bg-green-100 text-green-800 rounded-full text-sm font-semibold">
          SAVE R{savings.toLocaleString()}
        </div>

        <h1 className="text-3xl font-bold mb-2">Treasury + Credit Bureau Bundle</h1>
        <p className="text-gray-600 mb-8">Perfect for platforms managing agent networks</p>

        <div className="mb-8 p-6 bg-gray-50 rounded-lg">
          <div className="flex items-baseline gap-2 mb-2">
            <div className="text-5xl font-bold text-indigo-600">R{bundlePrice.toLocaleString()}</div>
            <div className="text-lg text-gray-500 line-through">R{(bundlePrice + savings).toLocaleString()}</div>
          </div>
          <div className="text-gray-600">/month</div>
          <p className="text-sm text-green-600 font-semibold mt-2">Save {Math.round((savings / (bundlePrice + savings)) * 100)}% when bundled</p>
        </div>

        <div className="space-y-4 mb-8 p-6 bg-blue-50 rounded-lg">
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Treasury (R40K/mo)</h3>
            <p className="text-sm text-gray-600">Daily netting, OFAC screening, multi-currency settlements</p>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900 mb-2">Credit Bureau (R8.5K/mo)</h3>
            <p className="text-sm text-gray-600">Real-time scoring, on-chain settlement, 25% partner revenue</p>
          </div>
        </div>

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 mb-4"
        >
          {loading ? 'Starting...' : 'Start Free Trial'}
        </button>

        <p className="text-xs text-gray-500 text-center">14-day free trial on both products</p>
      </div>
    </div>
  );
}
