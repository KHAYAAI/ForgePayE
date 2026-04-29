'use client';
import { Lock } from 'lucide-react';
import { useState } from 'react';

export function ComingSoonOverlay() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className="relative flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
      {/* Blurred background hint */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none opacity-20 blur-sm">
        <div className="p-6 space-y-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-12 bg-white/10 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Overlay content */}
      <div className="relative z-10 flex flex-col items-center gap-6 max-w-md">
        <div className="h-16 w-16 rounded-2xl bg-[#0A2540] border border-cyan-500/40 flex items-center justify-center shadow-lg shadow-cyan-500/20">
          <Lock className="h-7 w-7 text-cyan-400" />
        </div>
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-400 uppercase tracking-widest mb-3">
            <span className="h-px w-6 bg-cyan-500/40" />
            Coming Soon
            <span className="h-px w-6 bg-cyan-500/40" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">Forge Agent</h2>
          <p className="text-sm text-slate-400 leading-relaxed">
            Your AI billing co-pilot. Query revenue, trigger refunds, and get integration
            code — all in plain English. Currently in closed beta.
          </p>
        </div>

        {!submitted ? (
          <form
            onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
            className="flex w-full gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
              required
              className="flex-1 bg-white/[0.06] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500/60"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-navy-900 font-semibold text-sm rounded-lg transition-colors whitespace-nowrap"
              style={{ color: '#0A2540' }}
            >
              Notify me
            </button>
          </form>
        ) : (
          <p className="text-sm text-cyan-400 font-medium">✓ You&apos;re on the list!</p>
        )}
      </div>
    </div>
  );
}
