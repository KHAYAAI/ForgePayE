'use client';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

export default function TopBar() {
  const pathname = usePathname();
  const [time, setTime] = useState('');

  useEffect(() => {
    const update = () => setTime(new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC');
    update();
    const t = setInterval(update, 1000);
    return () => clearInterval(t);
  }, []);

  const crumb = pathname === '/' ? 'OVERVIEW' : pathname.slice(1).replace(/-/g, '_').toUpperCase();

  return (
    <header className="h-12 flex items-center justify-between px-6 border-b border-[#1A1A1A] bg-transparent shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-[#444] text-xs font-mono">FORGEPAY</span>
        <span className="text-[#333] text-xs">/</span>
        <span className="text-white text-xs font-mono font-medium">{crumb}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-[#39D353] animate-pulse" />
          <span className="text-[#39D353] text-xs font-mono">LIVE</span>
        </div>
        <span className="text-[#444] text-xs font-mono">{time}</span>
      </div>
    </header>
  );
}
