'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCustomer } from '@/hooks/useCustomer';

type Step = 'plaid' | 'counterparties' | 'ofac' | 'schedule' | 'complete';

export default function TreasuryOnboarding() {
  const router = useRouter();
  const { customer, refetch } = useCustomer();
  const [step, setStep] = useState<Step>('plaid');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handlePlaidConnect = async () => {
    setLoading(true);
    try {
      // Initiate Plaid Link flow
      const response = await fetch('/api/v1/treasury/plaid-link-token', {
        method: 'POST',
      });
      const data = await response.json();
      // Open Plaid Link modal (simplified - in real app use plaid-link package)
      console.log('Plaid link token:', data.linkToken);
      setStep('counterparties');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleAddCounterparties = async () => {
    setStep('ofac');
  };

  const handleSetOFACPolicy = async () => {
    setLoading(true);
    try {
      await fetch('/api/v1/treasury/ofac-policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          strictMode: true,
          delayHours: 24,
        }),
      });
      setStep('schedule');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSetSchedule = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/customer/products/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer?.id,
          product: 'treasury',
          plan: 'standard',
        }),
      });

      if (!response.ok) throw new Error('Failed to grant license');
      await refetch();
      setStep('complete');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-12 max-w-2xl w-full">
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {['Bank', 'Counterparties', 'OFAC', 'Schedule', 'Done'].map((label, i) => (
              <div
                key={label}
                className={`text-sm font-semibold ${
                  ['plaid', 'counterparties', 'ofac', 'schedule', 'complete'].indexOf(
                    step
                  ) >= i
                    ? 'text-green-600'
                    : 'text-gray-400'
                }`}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="w-full bg-gray-200 h-2 rounded-full">
            <div
              className="bg-green-600 h-2 rounded-full transition-all"
              style={{
                width: `${
                  ((['plaid', 'counterparties', 'ofac', 'schedule', 'complete'].indexOf(
                    step
                  ) +
                    1) /
                    5) *
                  100
                }%`,
              }}
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded text-red-700">
            {error}
          </div>
        )}

        {step === 'plaid' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Connect Your Bank</h2>
            <p className="text-gray-600 mb-6">
              Link your bank account to start settling agent payouts automatically.
            </p>
            <button
              onClick={handlePlaidConnect}
              disabled={loading}
              className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect Bank via Plaid'}
            </button>
          </div>
        )}

        {step === 'counterparties' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Add Counterparties</h2>
            <p className="text-gray-600 mb-6">
              Add the agents or vendors who will receive settlements from your treasury.
            </p>
            <button
              onClick={handleAddCounterparties}
              disabled={loading}
              className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Continue (Setup Later)'}
            </button>
          </div>
        )}

        {step === 'ofac' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">OFAC Compliance</h2>
            <p className="text-gray-600 mb-6">
              Enable sanctions screening to ensure your counterparties are compliant.
            </p>
            <button
              onClick={handleSetOFACPolicy}
              disabled={loading}
              className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Enabling...' : 'Enable OFAC Screening'}
            </button>
          </div>
        )}

        {step === 'schedule' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Settlement Schedule</h2>
            <p className="text-gray-600 mb-6">
              Set when daily settlements should occur. Default: 22:00 UTC.
            </p>
            <button
              onClick={handleSetSchedule}
              disabled={loading}
              className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Set to Default (22:00 UTC)'}
            </button>
          </div>
        )}

        {step === 'complete' && (
          <div className="text-center">
            <div className="mb-6 text-6xl">✓</div>
            <h2 className="text-3xl font-bold mb-2">Treasury Ready!</h2>
            <p className="text-gray-600 mb-8">
              Your first netting settlement will run tonight at 22:00 UTC.
            </p>
            <button
              onClick={() => router.push('/dashboard/treasury/positions')}
              className="px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700"
            >
              View Positions
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
