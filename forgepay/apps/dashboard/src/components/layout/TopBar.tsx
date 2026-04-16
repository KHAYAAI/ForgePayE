'use client';

import { Bell, Search } from 'lucide-react';

export default function TopBar() {
  return (
    <header className="h-14 flex items-center gap-4 px-6 border-b border-white/[0.07] bg-surface-900/50 backdrop-blur-sm shrink-0">
      {/* Search */}
      <div className="flex-1 max-w-xs relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input
          type="text"
          placeholder="Search payments, customers…"
          className="w-full bg-white/[0.04] border border-white/[0.07] rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-cyan-500/30 transition-colors"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        {/* Test mode badge */}
        <span className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
          Test mode
        </span>

        {/* Notifications */}
        <button className="relative p-1.5 text-gray-400 hover:text-white transition-colors">
          <Bell size={15} />
          <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 bg-cyan-500 rounded-full" />
        </button>

        {/* Avatar */}
        <div className="w-7 h-7 rounded-full bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center cursor-pointer">
          <span className="text-[10px] font-bold text-cyan-400">AC</span>
        </div>
      </div>
    </header>
  );
}
