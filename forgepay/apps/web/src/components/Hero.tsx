'use client';

import Link from 'next/link';
import { ArrowRight, Zap } from 'lucide-react';

const STATS = [
  { value: '200+', label: 'Countries (tax)' },
  { value: '100+', label: 'Payment processors' },
  { value: '0.8%', label: 'Stablecoin fee' },
  { value: '99.99%', label: 'Uptime SLA' },
];

export default function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-hero" />

      {/* Animated grid */}
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(#00F0FF 1px, transparent 1px), linear-gradient(90deg, #00F0FF 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />

      {/* Cyan glow orbs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 bg-cyan-500/8 rounded-full blur-3xl pointer-events-none" />

      <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 bg-cyan-500/10 border border-cyan-500/30 rounded-full px-4 py-1.5 mb-8">
          <Zap size={14} className="text-cyan-400" />
          <span className="text-xs font-semibold text-cyan-300 tracking-wide uppercase">
            Now open — $5/mo flat pricing
          </span>
        </div>

        {/* Headline */}
        <h1 className="text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight mb-6 leading-[1.05]">
          Payments,{' '}
          <span className="text-cyan-500 text-glow-cyan">forged better.</span>
        </h1>

        {/* Sub-headline */}
        <p className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto mb-10 leading-relaxed">
          One API for <strong className="text-white">cards</strong>,{' '}
          <strong className="text-white">bank transfers</strong>,{' '}
          <strong className="text-white">stablecoins</strong>, and{' '}
          <strong className="text-white">crypto</strong>. Built-in global tax compliance.
          Advanced billing for AI-native products.
          <br />
          <span className="text-gray-400">
            Beats Stripe on cost. Beats Paddle on features.
          </span>
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
          <Link
            href="/signup"
            className="group flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-bold px-8 py-4 rounded-xl text-base transition-all duration-200 glow-cyan hover:scale-105"
          >
            Start building free
            <ArrowRight
              size={16}
              className="group-hover:translate-x-1 transition-transform"
            />
          </Link>
          <Link
            href="/docs"
            className="flex items-center gap-2 border border-white/20 hover:border-cyan-500/50 text-white font-semibold px-8 py-4 rounded-xl text-base transition-all duration-200 hover:bg-white/5"
          >
            Read the docs
          </Link>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 max-w-2xl mx-auto">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <div className="text-2xl font-black text-cyan-400 mb-1">{stat.value}</div>
              <div className="text-xs text-gray-400 uppercase tracking-wide">{stat.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 opacity-40">
        <span className="text-xs text-gray-400 uppercase tracking-widest">Scroll</span>
        <div className="w-px h-8 bg-gradient-to-b from-gray-400 to-transparent" />
      </div>
    </section>
  );
}
