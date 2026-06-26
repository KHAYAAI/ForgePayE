'use client';
import Link from 'next/link';

export default function Navbar() {
  return (
    <nav className="fixed top-0 inset-x-0 z-50 h-14 flex items-center justify-between px-8 border-b border-[#1A1A1A] bg-[#0A0A0A]/90 backdrop-blur-sm">
      <Link href="/" className="flex items-center gap-2">
        <span className="text-white text-xl font-mono font-bold">✳</span>
        <span className="text-white text-sm font-mono font-semibold tracking-widest">FORGEPAY</span>
      </Link>
      <div className="flex items-center gap-8">
        {['DOCS', 'PRICING', 'STATUS', 'COMPANY'].map(label => (
          <Link
            key={label}
            href={`/${label.toLowerCase()}`}
            className="text-[#6B7280] text-xs font-mono hover:text-white transition-colors tracking-wider"
          >
            {label}
          </Link>
        ))}
        <Link
          href="/dashboard"
          className="text-[#39D353] text-xs font-mono border border-[#39D353] px-4 py-1.5 rounded hover:bg-[#39D35310] transition-colors tracking-wider"
        >
          LAUNCH APP →
        </Link>
      </div>
    </nav>
  );
}
