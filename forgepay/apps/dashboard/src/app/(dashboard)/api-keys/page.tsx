'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Copy, Eye, EyeOff, Plus, Trash2, ShieldCheck, RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { TableRowSkeleton } from '@/components/ui/Skeleton';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ApiKey {
  id: string;
  name: string;
  key: string;
  mode: string;
  created: string;
  last_used: string;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="text-gray-500 hover:text-gray-300 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <CheckCircle2 size={12} className="text-green-400" /> : <Copy size={12} />}
    </button>
  );
}

export default function ApiKeysPage() {
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const { data, isLoading } = useSWR<{ data: ApiKey[]; count: number }>('/api/api-keys', fetcher);

  // Rotation state
  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotating, setRotating]                   = useState(false);
  const [newKey, setNewKey]                       = useState<string | null>(null);
  const [rotateError, setRotateError]             = useState<string | null>(null);
  const [newKeyCopied, setNewKeyCopied]           = useState(false);

  // Webhook secret state
  const [showWebhookSecret, setShowWebhookSecret] = useState(false);
  const WEBHOOK_SECRET = 'whsec_••••••••••••••••••••••••••••••••';
  const WEBHOOK_SECRET_REAL = 'whsec_placeholder_secret_value_here';

  const keys: ApiKey[] = data?.data ?? [];

  const handleRotate = async () => {
    setRotating(true);
    setRotateError(null);
    try {
      const res = await fetch('/api/api-keys/rotate', { method: 'POST' });
      if (res.ok) {
        const body = (await res.json()) as { apiKey: string; rotatedAt: string };
        setNewKey(body.apiKey);
        setShowRotateConfirm(false);
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setRotateError(err.error ?? 'Rotation failed. Please try again.');
        setShowRotateConfirm(false);
      }
    } catch {
      setRotateError('Network error. Please try again.');
      setShowRotateConfirm(false);
    } finally {
      setRotating(false);
    }
  };

  const handleCopyNewKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey).catch(() => null);
    setNewKeyCopied(true);
    setTimeout(() => setNewKeyCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">API Keys</h1>
          <p className="text-sm text-gray-400">Authenticate your server-side ForgePay requests</p>
        </div>
        <button className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-white font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors">
          <Plus size={13} /> New key
        </button>
      </div>

      {/* Security notice */}
      <div className="flex gap-3 bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
        <ShieldCheck size={16} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-200/70 leading-relaxed">
          API keys carry full access to your ForgePay account. Never expose them in client-side code,
          commit them to source control, or share them. Use environment variables.
        </p>
      </div>

      {/* New key revealed after rotation */}
      {newKey && (
        <div className="bg-green-500/5 border border-green-500/30 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-semibold text-sm">
            <CheckCircle2 size={16} />
            API key rotated successfully
          </div>
          <p className="text-xs text-amber-300 font-semibold">
            Copy and save this key — it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-green-300 bg-green-500/10 border border-green-500/20 px-3 py-2 rounded-lg break-all">
              {newKey}
            </code>
            <button
              onClick={handleCopyNewKey}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors text-xs font-semibold"
            >
              {newKeyCopied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
              {newKeyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <button
            onClick={() => setNewKey(null)}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Rotation error */}
      {rotateError && (
        <div className="flex items-center gap-2 bg-red-500/5 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
          <AlertTriangle size={15} />
          {rotateError}
          <button onClick={() => setRotateError(null)} className="ml-auto text-xs underline">Dismiss</button>
        </div>
      )}

      {/* Keys table */}
      <div className="card overflow-hidden">
        <table className="w-full fp-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Key</th>
              <th>Mode</th>
              <th>Created</th>
              <th>Last Used</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <>
                <TableRowSkeleton cols={6} />
                <TableRowSkeleton cols={6} />
              </>
            ) : (
              keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium text-white">{k.name}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <code className="text-xs font-mono text-gray-300 bg-white/5 px-2 py-0.5 rounded">
                        {showKey[k.id] ? k.key : k.key.slice(0, 16) + '••••••••'}
                      </code>
                      <button
                        className="text-gray-500 hover:text-gray-300"
                        onClick={() => setShowKey((s) => ({ ...s, [k.id]: !s[k.id] }))}
                      >
                        {showKey[k.id] ? <EyeOff size={12} /> : <Eye size={12} />}
                      </button>
                      <CopyButton value={k.key} />
                    </div>
                  </td>
                  <td>
                    <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${
                      k.mode === 'live'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                    }`}>
                      {k.mode}
                    </span>
                  </td>
                  <td className="text-gray-400 text-xs">{k.created}</td>
                  <td className="text-gray-400 text-xs">{k.last_used}</td>
                  <td>
                    <button className="text-gray-600 hover:text-red-400 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Key rotation section */}
      <div className="card p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Rotate API Key</h3>
            <p className="text-xs text-gray-400 mt-1">
              Generate a new API key and immediately revoke the current one. Update your servers before rotating.
            </p>
          </div>
          {!showRotateConfirm && (
            <button
              onClick={() => setShowRotateConfirm(true)}
              disabled={rotating}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-gray-300 hover:text-white hover:border-white/20 text-xs font-semibold transition-colors shrink-0 disabled:opacity-50"
            >
              <RefreshCw size={12} />
              Rotate Key
            </button>
          )}
        </div>

        {/* Inline confirmation */}
        {showRotateConfirm && (
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-200/80 leading-relaxed">
                <strong className="text-amber-300">Are you sure?</strong> Your current API key will be immediately
                revoked. Any servers still using the old key will receive 401 errors until updated.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRotate}
                disabled={rotating}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
              >
                {rotating && <Loader2 size={12} className="animate-spin" />}
                {rotating ? 'Rotating...' : 'Yes, rotate key'}
              </button>
              <button
                onClick={() => setShowRotateConfirm(false)}
                disabled={rotating}
                className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-400 hover:text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Webhook signing secret */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Webhook Signing Secret</h3>
        <p className="text-xs text-gray-400 mb-3">
          Used to verify that webhook payloads come from ForgePay (HMAC-SHA256).
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-gray-300 bg-white/5 border border-white/10 px-3 py-2 rounded-lg">
            {showWebhookSecret ? WEBHOOK_SECRET_REAL : WEBHOOK_SECRET}
          </code>
          <button
            onClick={() => setShowWebhookSecret((v) => !v)}
            className="text-gray-500 hover:text-gray-300 transition-colors"
          >
            {showWebhookSecret ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <CopyButton value={WEBHOOK_SECRET_REAL} />
        </div>
      </div>
    </div>
  );
}
