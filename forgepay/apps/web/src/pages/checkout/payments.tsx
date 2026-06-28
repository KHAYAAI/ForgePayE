'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState } from 'react';

export default function PaymentsCheckout() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const tier = searchParams.get('tier') || 'growth';
  const [loading, setLoading] = useState(false);

  const plans = {
    free: { name: 'Free', price: 0, billingCycle: 'Forever free', description: '14-day trial, then free forever' },
    growth: { name: 'Growth', price: 15000, billingCycle: '/month', description: 'Best for scaling businesses' },
  };

  const plan = plans[tier as keyof typeof plans] || plans.growth;

  const handleCheckout = async () => {
    setLoading(true);
    try {
      // Redirect to Kill Bill checkout or Stripe Checkout
      // For now, simplified flow
      const response = await fetch('/api/v1/checkout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: 'payments',
          plan: tier,
        }),
      });

      const data = await response.json();
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      } else if (data.authenticated) {
        router.push(`/dashboard/onboarding/payments?tier=${tier}`);
      }
    } catch (err) {
      console.error('Checkout error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-8">
        <h1 className="text-3xl font-bold mb-2">FORGE Payments</h1>
        <p className="text-gray-600 mb-8">{plan.description}</p>

        <div className="mb-8 p-6 bg-gray-50 rounded-lg">
          <div className="text-5xl font-bold text-indigo-600 mb-2">
            R{plan.price.toLocaleString()}
          </div>
          <div className="text-gray-600">{plan.billingCycle}</div>
        </div>

        <ul className="space-y-4 mb-8 text-sm text-gray-700">
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>40% lower fees than Stripe</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>Multi-currency support (ZAR, USD, EUR)</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>Instant settlements to your bank</span>
          </li>
          <li className="flex items-start">
            <span className="text-green-500 mr-3">✓</span>
            <span>14-day free trial (no card required)</span>
          </li>
        </ul>

        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 mb-4"
        >
          {loading ? 'Starting...' : 'Get Started'}
        </button>

        <p className="text-xs text-gray-500 text-center">
          No credit card required for 14-day trial
        </p>
      </div>
    </div>
  );
}
