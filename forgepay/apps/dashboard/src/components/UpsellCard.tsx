'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface Signal {
  product: string;
  tier?: string;
  readiness: 'high' | 'medium' | 'low';
  estimatedMonthlyValue: number;
  message: string;
  urgency: number;
}

export function UpsellCard() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchSignals = async () => {
      try {
        const res = await fetch('/api/v1/csm/dashboard');
        const data = await res.json();
        setSignals(data.upsell_signals || []);
      } catch (err) {
        console.error('Failed to fetch upsell signals:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSignals();
  }, []);

  if (loading || signals.length === 0) return null;

  const topSignal = signals[0];
  const colors: Record<string, string> = {
    payments: 'from-blue-500 to-blue-600',
    treasury: 'from-green-500 to-emerald-600',
    'credit-bureau': 'from-purple-500 to-pink-600',
  };

  const checkoutUrls: Record<string, string> = {
    payments: '/checkout/payments?tier=growth',
    treasury: '/checkout/treasury',
    'credit-bureau': '/checkout/credit-bureau',
  };

  const colorClass = colors[topSignal.product] || 'from-indigo-500 to-indigo-600';
  const checkoutUrl = checkoutUrls[topSignal.product] || '/checkout';

  return (
    <div
      className={`bg-gradient-to-r ${colorClass} text-white p-6 rounded-lg shadow-lg mb-6`}
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <h3 className="text-lg font-bold mb-1">
            {topSignal.product === 'payments' && 'Upgrade to Payments'}
            {topSignal.product === 'treasury' && 'Unlock Treasury'}
            {topSignal.product === 'credit-bureau' && 'Add Credit Bureau'}
          </h3>
          <p className="text-sm opacity-90">{topSignal.message}</p>
        </div>
        <span className="text-2xl font-bold opacity-75">
          +R{(topSignal.estimatedMonthlyValue / 1000).toFixed(0)}K/mo
        </span>
      </div>

      <div className="flex gap-3">
        <Link
          href={checkoutUrl}
          className="px-4 py-2 bg-white text-gray-900 font-semibold rounded hover:bg-gray-100 transition text-sm"
        >
          Learn More
        </Link>
        <button className="px-4 py-2 border border-white rounded hover:bg-white hover:bg-opacity-10 transition text-sm">
          Dismiss
        </button>
      </div>
    </div>
  );
}
