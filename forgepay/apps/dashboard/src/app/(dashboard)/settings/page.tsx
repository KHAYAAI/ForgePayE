'use client';

import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { Save, Loader2, Key, Bell, Shield, Globe } from 'lucide-react';

export default function SettingsPage() {
  const { data: session } = useSession();

  const [email,    setEmail]    = useState(session?.user?.email ?? '');
  const [name,     setName]     = useState(session?.user?.name  ?? '');
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    // Profile update would call PUT /api/merchant/profile — wired to mor-layer
    await new Promise((r) => setTimeout(r, 600));
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const apiKey = (session?.user as { apiKey?: string })?.apiKey ?? '';

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-bold text-white">Settings</h1>
        <p className="text-sm text-gray-400">Manage your merchant account preferences.</p>
      </div>

      {/* Profile */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Globe size={16} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Profile</h3>
        </div>
        <form onSubmit={save} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Display Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-navy-800 font-bold px-4 py-2 rounded-lg text-sm transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {saved ? 'Saved!' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* API Keys */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Key size={16} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">API Keys</h3>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-1.5">Live Secret Key</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-navy-900/60 border border-white/10 rounded-lg px-3.5 py-2.5 text-xs text-gray-300 font-mono truncate">
                {apiKey ? `${apiKey.slice(0, 12)}${'•'.repeat(24)}` : '••••••••••••••••••••••••••••••••••••'}
              </code>
            </div>
          </div>
          <p className="text-xs text-gray-500">
            Keep your secret key safe — never expose it in browser code or public repos.
            Use environment variables on your server.
          </p>
        </div>
      </div>

      {/* Notifications */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Bell size={16} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Notifications</h3>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Payment succeeded',  desc: 'Notify when a payment is completed' },
            { label: 'Payment failed',     desc: 'Alert on failed or declined payments' },
            { label: 'Subscription events', desc: 'Trial endings, cancellations, renewals' },
            { label: 'Weekly summary',     desc: 'Revenue and conversion digest' },
          ].map(({ label, desc }) => (
            <div key={label} className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
              <div>
                <div className="text-sm text-white">{label}</div>
                <div className="text-xs text-gray-500">{desc}</div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" defaultChecked className="sr-only peer" />
                <div className="w-9 h-5 bg-white/10 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 peer-checked:after:bg-cyan-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500/20" />
              </label>
            </div>
          ))}
        </div>
      </div>

      {/* Security */}
      <div className="card p-6">
        <div className="flex items-center gap-2 mb-5">
          <Shield size={16} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Security</h3>
        </div>
        <div className="space-y-3">
          <button className="w-full text-left py-3 px-4 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-lg text-sm text-white transition-colors">
            Change Password
          </button>
          <button className="w-full text-left py-3 px-4 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-lg text-sm text-white transition-colors">
            Enable Two-Factor Authentication
          </button>
          <button className="w-full text-left py-3 px-4 bg-red-500/5 hover:bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400 transition-colors">
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}
