'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCustomer } from '@/hooks/useCustomer';

type Step = 'tier-select' | 'api-key' | 'test-payment' | 'complete';

export default function PaymentsOnboarding() {
  const router = useRouter();
  const { customer, refetch } = useCustomer();
  const [step, setStep] = useState<Step>('tier-select');
  const [tier, setTier] = useState<'free' | 'growth'>('free');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSelectTier = async (selectedTier: 'free' | 'growth') => {
    setTier(selectedTier);
    setLoading(true);
    try {
      const plan = selectedTier === 'free' ? 'free-trial' : 'growth';
      const response = await fetch('/api/v1/customer/products/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer?.id,
          product: 'payments',
          plan,
        }),
      });

      if (!response.ok) throw new Error('Failed to grant license');
      await refetch();
      setStep('api-key');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateApiKey = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/customer/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Payments Onboarding' }),
      });

      if (!response.ok) throw new Error('Failed to generate API key');
      const data = await response.json();
      setApiKey(data.key);
      setStep('test-payment');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTestPayment = async () => {
    setLoading(true);
    try {
      // Send test charge via customer's API key
      const response = await fetch('https://api.forgepay.com/v1/payments/charges', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          amount: 1000, // R10 test charge
          currency: 'ZAR',
          description: 'Onboarding test charge',
        }),
      });

      if (!response.ok) throw new Error('Test payment failed');
      setStep('complete');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = () => {
    router.push('/dashboard/payments/charges');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-12 max-w-2xl w-full">
        {/* Progress bar */}
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {['Tier', 'API Key', 'Test', 'Done'].map((label, i) => (
              <div
                key={label}
                className={`text-sm font-semibold ${
                  ['tier-select', 'api-key', 'test-payment', 'complete'].indexOf(step) >=
                  i
                    ? 'text-indigo-600'
                    : 'text-gray-400'
                }`}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="w-full bg-gray-200 h-2 rounded-full">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all"
              style={{
                width: `${
                  ((['tier-select', 'api-key', 'test-payment', 'complete'].indexOf(
                    step
                  ) +
                    1) /
                    4) *
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

        {/* Step 1: Tier Selection */}
        {step === 'tier-select' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Choose Your Plan</h2>
            <div className="grid grid-cols-2 gap-6 mb-8">
              {[
                { name: 'Free', description: 'Perfect for testing', price: 'R0/mo' },
                { name: 'Growth', description: 'For scaling businesses', price: 'R15K/mo' },
              ].map((plan, idx) => (
                <button
                  key={plan.name}
                  onClick={() => handleSelectTier(['free', 'growth'][idx] as any)}
                  disabled={loading}
                  className="p-6 border-2 border-gray-200 rounded-lg hover:border-indigo-600 transition text-left"
                >
                  <h3 className="font-bold text-lg">{plan.name}</h3>
                  <p className="text-gray-600 text-sm mb-4">{plan.description}</p>
                  <p className="text-2xl font-bold text-indigo-600">{plan.price}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 2: API Key */}
        {step === 'api-key' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Generate API Key</h2>
            <p className="text-gray-600 mb-6">
              Your API key is required to start processing payments. Keep it secure!
            </p>
            {apiKey && (
              <div className="mb-6 p-4 bg-gray-50 border border-gray-200 rounded font-mono text-sm break-all">
                {apiKey}
              </div>
            )}
            <button
              onClick={handleGenerateApiKey}
              disabled={loading || !!apiKey}
              className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate API Key'}
            </button>
          </div>
        )}

        {/* Step 3: Test Payment */}
        {step === 'test-payment' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Test Payment</h2>
            <p className="text-gray-600 mb-6">
              Let's send a test payment to verify everything is working. We'll charge R10 to your account.
            </p>
            <button
              onClick={handleTestPayment}
              disabled={loading}
              className="w-full px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Send Test Payment'}
            </button>
          </div>
        )}

        {/* Step 4: Complete */}
        {step === 'complete' && (
          <div className="text-center">
            <div className="mb-6 text-6xl">✓</div>
            <h2 className="text-3xl font-bold mb-2">All Set!</h2>
            <p className="text-gray-600 mb-8">
              Your FORGE Payments account is ready to go. Start processing payments now.
            </p>
            <button
              onClick={handleComplete}
              className="px-8 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700"
            >
              Go to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
