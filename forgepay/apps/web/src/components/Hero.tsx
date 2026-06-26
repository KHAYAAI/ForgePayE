'use client';

import Link from 'next/link';
import { PRICING } from '@/lib/pricing';

const STATS = [
  { value: '$15B',   label: 'TVL SECURED' },
  { value: '200+',   label: 'COUNTRIES' },
  { value: '100+',   label: 'PROCESSORS' },
  { value: '99.99%', label: 'UPTIME SLA' },
];

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-14">
      {/* Faint grid background */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(#39D353 1px, transparent 1px), linear-gradient(90deg, #39D353 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />

      {/* Subtle green horizon glow */}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[200px] bg-[#39D353]/5 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute left-1/2 bottom-0 -translate-x-1/2 w-[800px] h-[1px] bg-gradient-to-r from-transparent via-[#39D35330] to-transparent pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-8 text-left">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 border border-[#1E1E1E] bg-[#111111] px-3 py-1 mb-10">
          <span className="w-1.5 h-1.5 rounded-full bg-[#39D353] animate-pulse-green inline-block" />
          <span className="text-[10px] font-mono text-[#6B7280] tracking-widest uppercase">
            // AI PAYMENT INFRASTRUCTURE
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold font-mono tracking-tight leading-[1.08] mb-6">
          <span className="text-white">Payment infrastructure</span>
          <span className="text-[#39D353] animate-blink">_</span>
          <br />
          <span className="text-[#6B7280]">for autonomous economies.</span>
        </h1>

        {/* Sub-headline */}
        <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-3 leading-relaxed">
          One API for cards, stablecoins, crypto, and AI agent payments.
        </p>
        <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-12 leading-relaxed">
          Built-in global tax compliance. Advanced billing for AI-native products.
          Beats Stripe on cost. Beats Paddle on features.
        </p>

        {/* CTAs */}
        <div className="flex flex-row items-center gap-4 mb-20">
          <Link
            href="/signup"
            className="text-[#39D353] text-xs font-mono border border-[#39D353] px-6 py-2.5 hover:bg-[#39D35310] transition-colors tracking-wider glow-green"
          >
            START BUILDING →
          </Link>
          <Link
            href="/docs"
            className="text-[#6B7280] text-xs font-mono border border-[#1E1E1E] px-6 py-2.5 hover:text-white hover:border-[#333] transition-colors tracking-wider"
          >
            READ THE DOCS
          </Link>
        </div>

        {/* Stats row */}
        <div className="flex flex-row items-center gap-0 border border-[#1E1E1E] bg-[#111111] divide-x divide-[#1E1E1E] w-fit">
          {STATS.map((stat) => (
            <div key={stat.label} className="px-8 py-4 text-left">
              <div className="text-xl font-mono font-bold text-[#39D353] text-glow-green mb-0.5">
                {stat.value}
              </div>
              <div className="text-[10px] font-mono text-[#6B7280] tracking-widest">
                {stat.label}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-8 flex flex-col items-start gap-1 opacity-30">
        <span className="text-[10px] font-mono text-[#6B7280] tracking-widest">SCROLL</span>
        <div className="w-px h-6 bg-gradient-to-b from-[#6B7280] to-transparent" />
      </div>
    </section>
  );
}
