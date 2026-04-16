'use client';

import type { Metadata } from 'next';
import { useState } from 'react';
import { Copy, Eye, EyeOff, Plus, Trash2, ShieldCheck } from 'lucide-react';

// Stub data
const KEYS = [
  { id: 'key_01', name: 'Production', key: 'fpk_live_3xT4...k9mN', mode: 'live', created: 'Apr 1, 2026', last_used: '2 min ago' },
  { id: 'key_02', name: 'Test',       key: 'fpk_test_7yU8...q2pX', mode: 'test', created: 'Mar 15, 2026', last_used: '1 hr ago' },
];

export default function ApiKeysPage() {
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">API Keys</h1>
          <p className="text-sm text-gray-400">Authenticate your server-side ForgePay requests</p>
        </div>
        <button className="flex items-center gap-1.5 bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-semibold text-xs px-3.5 py-2 rounded-lg transition-colors">
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
            {KEYS.map((k) => (
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
                    <button className="text-gray-500 hover:text-gray-300">
                      <Copy size={12} />
                    </button>
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
            ))}
          </tbody>
        </table>
      </div>

      {/* Webhook signing secret */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-white mb-1">Webhook Signing Secret</h3>
        <p className="text-xs text-gray-400 mb-3">
          Used to verify that webhook payloads come from ForgePay (HMAC-SHA256).
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 text-xs font-mono text-gray-300 bg-white/5 border border-white/10 px-3 py-2 rounded-lg">
            whsec_••••••••••••••••••••••••••••••••
          </code>
          <button className="text-gray-500 hover:text-gray-300"><Eye size={14} /></button>
          <button className="text-gray-500 hover:text-gray-300"><Copy size={14} /></button>
        </div>
      </div>
    </div>
  );
}
