'use client';

import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { Plus, Trash2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface WebhookEndpoint {
  id:          string;
  endpoint_url: string;
  enabled:     boolean;
  created_at:  string;
}

export default function WebhooksPage() {
  const { data, isLoading } = useSWR('/api/webhooks/endpoints', fetcher);
  const endpoints: WebhookEndpoint[] = data?.data ?? [];

  const [url,     setUrl]     = useState('');
  const [adding,  setAdding]  = useState(false);
  const [error,   setError]   = useState('');

  async function addEndpoint(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    setError('');
    try {
      const res = await fetch('/api/webhooks/endpoints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) throw new Error((await res.json() as { error?: string }).error ?? 'Failed');
      setUrl('');
      await mutate('/api/webhooks/endpoints');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add endpoint');
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Webhooks</h1>
        <p className="text-sm text-gray-400">Receive real-time events when payments, subscriptions, and invoices change.</p>
      </div>

      {/* Add endpoint form */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-4">Add Endpoint</h3>
        <form onSubmit={addEndpoint} className="flex gap-3">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://your-site.com/webhooks/forgepay"
            required
            className="flex-1 bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
          <button
            type="submit"
            disabled={adding}
            className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-navy-800 font-bold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
        </form>
        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>

      {/* Events reference */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Event Types</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {[
            'payment.succeeded', 'payment.failed', 'payment.refunded',
            'subscription.created', 'subscription.cancelled', 'invoice.paid',
            'crypto.payment.received', 'stablecoin.payment.received',
          ].map((t) => (
            <code key={t} className="text-xs bg-white/5 text-cyan-300 px-2 py-1 rounded font-mono">
              {t}
            </code>
          ))}
        </div>
      </div>

      {/* Endpoints list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-white/[0.07]">
          <h3 className="text-sm font-semibold text-white">Registered Endpoints</h3>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading…
          </div>
        ) : endpoints.length === 0 ? (
          <div className="text-center py-8 text-sm text-gray-500">No endpoints yet — add one above.</div>
        ) : (
          <table className="w-full fp-table">
            <thead>
              <tr>
                <th>URL</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {endpoints.map((ep) => (
                <tr key={ep.id}>
                  <td className="font-mono text-xs text-cyan-300 truncate max-w-xs">{ep.endpoint_url}</td>
                  <td>
                    {ep.enabled ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400">
                        <CheckCircle2 size={12} /> Active
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <AlertCircle size={12} /> Disabled
                      </span>
                    )}
                  </td>
                  <td className="text-gray-500 text-xs">
                    {new Date(ep.created_at).toLocaleDateString()}
                  </td>
                  <td>
                    <button className="text-gray-600 hover:text-red-400 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Signature verification guide */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Verify Webhook Signatures</h3>
        <pre className="text-xs bg-navy-900/60 rounded-lg p-4 overflow-x-auto text-cyan-300 leading-relaxed">
{`import { ForgePay } from '@forgepay/sdk';

const event = ForgePay.webhooks.constructEvent(
  rawBody,                           // Buffer — read before JSON.parse
  request.headers['forgepay-sig'],   // X-ForgePay-Sig header
  process.env.FORGEPAY_WEBHOOK_SECRET,
);

switch (event.type) {
  case 'payment.succeeded':
    // fulfil order ...
    break;
}`}
        </pre>
      </div>
    </div>
  );
}
