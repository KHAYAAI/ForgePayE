'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCustomer } from '@/hooks/useCustomer';

type Step = 'agents' | 'policy' | 'webhooks' | 'review' | 'complete';

export default function CreditBureauOnboarding() {
  const router = useRouter();
  const { customer, refetch } = useCustomer();
  const [step, setStep] = useState<Step>('agents');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleRegisterAgent = async () => {
    setLoading(true);
    try {
      // Simplified - in real app, load agents from customer's system
      await fetch('/api/v1/credit-bureau/agents/register-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agents: [],
        }),
      });
      setStep('policy');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleSetPolicy = async () => {
    try {
      await fetch('/api/v1/credit-bureau/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minScore: 500,
          maxVariance: 100,
        }),
      });
      setStep('webhooks');
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSetWebhooks = async () => {
    setLoading(true);
    try {
      await fetch('/api/v1/credit-bureau/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: `${window.location.origin}/api/webhooks/credit-bureau`,
          events: ['score.updated', 'agent.registered'],
        }),
      });
      setStep('review');
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/v1/customer/products/grant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: customer?.id,
          product: 'credit-bureau',
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
    <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-12 max-w-2xl w-full">
        <div className="mb-8">
          <div className="flex justify-between mb-2">
            {['Agents', 'Policy', 'Webhooks', 'Review', 'Done'].map((label, i) => (
              <div
                key={label}
                className={`text-sm font-semibold ${
                  ['agents', 'policy', 'webhooks', 'review', 'complete'].indexOf(step) >=
                  i
                    ? 'text-purple-600'
                    : 'text-gray-400'
                }`}
              >
                {label}
              </div>
            ))}
          </div>
          <div className="w-full bg-gray-200 h-2 rounded-full">
            <div
              className="bg-purple-600 h-2 rounded-full transition-all"
              style={{
                width: `${
                  ((['agents', 'policy', 'webhooks', 'review', 'complete'].indexOf(
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

        {step === 'agents' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Register Agents</h2>
            <p className="text-gray-600 mb-6">
              Import agents from your system or register them manually.
            </p>
            <button
              onClick={handleRegisterAgent}
              disabled={loading}
              className="w-full px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Continue (Setup Later)'}
            </button>
          </div>
        )}

        {step === 'policy' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Credit Policy</h2>
            <p className="text-gray-600 mb-6">
              Define your credit thresholds and risk tolerance.
            </p>
            <div className="space-y-4 mb-6">
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Min Score (0-1000)</span>
                <input
                  type="number"
                  defaultValue={500}
                  className="mt-2 w-full px-4 py-2 border border-gray-300 rounded"
                />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-gray-700">Max Variance (basis points)</span>
                <input
                  type="number"
                  defaultValue={100}
                  className="mt-2 w-full px-4 py-2 border border-gray-300 rounded"
                />
              </label>
            </div>
            <button
              onClick={handleSetPolicy}
              disabled={loading}
              className="w-full px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Set Policy'}
            </button>
          </div>
        )}

        {step === 'webhooks' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Setup Webhooks</h2>
            <p className="text-gray-600 mb-6">
              Receive real-time notifications when agent scores update.
            </p>
            <button
              onClick={handleSetWebhooks}
              disabled={loading}
              className="w-full px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Setting up...' : 'Configure Webhook'}
            </button>
          </div>
        )}

        {step === 'review' && (
          <div>
            <h2 className="text-3xl font-bold mb-6">Review Algorithm</h2>
            <p className="text-gray-600 mb-6">
              FORGE Credit Bureau uses dual-mode scoring:
            </p>
            <ul className="space-y-2 mb-6 text-sm text-gray-600">
              <li>• Mode 1: Off-chain FICO (40% payment history, 30% volume, 20% age, 10% risk)</li>
              <li>• Mode 2: On-chain operational (35% success rate, 30% volume, 20% compliance, 15% age)</li>
              <li>• Consensus: Automatic if variance &lt;50pts, flagged for review if &gt;100pts</li>
            </ul>
            <button
              onClick={handleComplete}
              disabled={loading}
              className="w-full px-6 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700 disabled:opacity-50"
            >
              {loading ? 'Enabling...' : 'Enable Credit Bureau'}
            </button>
          </div>
        )}

        {step === 'complete' && (
          <div className="text-center">
            <div className="mb-6 text-6xl">✓</div>
            <h2 className="text-3xl font-bold mb-2">All Set!</h2>
            <p className="text-gray-600 mb-8">
              Credit Bureau is live. First agent scores will be settled tonight at 20:00 UTC.
            </p>
            <button
              onClick={() => router.push('/dashboard/credit-bureau/agents')}
              className="px-8 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700"
            >
              View Agents
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
