/**
 * ARCH: FORGE Payments — product page
 * ──────────────────────────────────────────────────────────────────────────────
 * Rebuilt to match the site's design system, replacing generic "beats Stripe
 * by 40%" copy with what the platform actually does: stablecoin rails
 * (services/stablecoin-gateway) and crypto invoicing (services/crypto-gateway).
 *
 * Deliberately does NOT claim card processing — nothing in this codebase
 * builds or proves that, and the previous copy's "R15K/mo, ZAR/USD/EUR"
 * pricing didn't correspond to anything real either. If card support ships,
 * add it here then, backed by what actually exists.
 */

'use client';

import Link from 'next/link';
import { Coins, Zap, ShieldCheck, Repeat, Bitcoin, Gauge } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const CAPABILITIES = [
  {
    icon: Coins,
    title: 'USDC / USDT rails',
    description:
      'Inbound deposits and outbound payouts across EVM chains and Solana. The same rail that pays FORGE Credit Bureau furnishers, real USDC, confirmed on-chain.',
  },
  {
    icon: Zap,
    title: 'x402 micropayments',
    description:
      'HTTP-native, agent-to-agent payments. An agent pays for a resource inline with the request — no separate billing flow, no human in the loop.',
  },
  {
    icon: Gauge,
    title: 'Bounded payouts',
    description:
      'A rolling daily spend ceiling on the signing wallet, and human-approval thresholds above a configurable amount. The control that bounds the wallet, not just the transfer.',
  },
  {
    icon: Repeat,
    title: 'Idempotent settlement',
    description:
      'Every payout carries a stable external ID. A retried request returns the original result — it never sends money twice, enforced by the database, not application memory.',
  },
  {
    icon: Bitcoin,
    title: 'Crypto invoicing',
    description:
      'Invoice-based acceptance for BTC, ETH, LTC, and XMR — for merchants who want to accept crypto directly, alongside or instead of stablecoins.',
  },
  {
    icon: ShieldCheck,
    title: 'Screened by default',
    description:
      'Payout destinations and counterparties run through sanctions screening before funds move — the same fail-closed compliance layer behind the Credit Bureau.',
  },
];

export default function PaymentsPage() {
  return (
    <main className="min-h-screen bg-forge-bg">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-20 px-8 overflow-hidden">
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage:
              'linear-gradient(#39D353 1px, transparent 1px), linear-gradient(90deg, #39D353 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        />
        <div className="relative z-10 max-w-4xl mx-auto text-left">
          <div className="inline-flex items-center gap-2 border border-[#1E1E1E] bg-[#111111] px-3 py-1 mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-[#39D353] animate-pulse-green inline-block" />
            <span className="text-[10px] font-mono text-[#6B7280] tracking-widest uppercase">
              // STABLECOIN &amp; CRYPTO PAYMENT RAILS
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-mono tracking-tight leading-[1.1] mb-6">
            <span className="text-white">Payment rails built</span>
            <span className="text-[#39D353] animate-blink">_</span>
            <br />
            <span className="text-[#6B7280]">for agents that move money.</span>
          </h1>

          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-3 leading-relaxed">
            USDC and USDT across EVM chains and Solana, x402 for inline agent-to-agent payments,
            and crypto invoicing when you need it — with bounded, idempotent, sanctions-screened
            payouts by default.
          </p>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-12 leading-relaxed">
            This is the same rail FORGE Credit Bureau uses to pay furnishers — not a demo, the
            production payout path.
          </p>

          <div className="flex flex-row items-center gap-4">
            <Link
              href="/checkout/payments"
              className="text-[#39D353] text-xs font-mono border border-[#39D353] px-6 py-2.5 hover:bg-[#39D35310] transition-colors tracking-wider glow-green"
            >
              GET API ACCESS →
            </Link>
            <Link
              href="/docs"
              className="text-[#6B7280] text-xs font-mono border border-[#1E1E1E] px-6 py-2.5 hover:text-white hover:border-[#333] transition-colors tracking-wider"
            >
              READ THE DOCS
            </Link>
          </div>
        </div>
      </section>

      {/* Capabilities */}
      <section className="py-20 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// CAPABILITIES</p>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-3 tracking-tight">
              Not a wrapper around someone else's rail.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[#1E1E1E]">
            {CAPABILITIES.map((cap) => {
              const Icon = cap.icon;
              return (
                <div
                  key={cap.title}
                  className="group bg-[#111111] p-6 border border-[#1E1E1E] hover:border-[#39D35330] transition-colors duration-200"
                >
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-[#39D353] text-xs font-mono">&gt;</span>
                    <Icon size={14} className="text-[#39D353]" />
                  </div>
                  <h3 className="text-sm font-mono font-bold text-white mb-2 tracking-tight">
                    {cap.title}
                  </h3>
                  <p className="text-xs font-mono text-[#6B7280] leading-relaxed">
                    {cap.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Proven, not promised */}
      <section className="py-20 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">
            // PROVEN, NOT PROMISED
          </p>
          <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-6 tracking-tight">
            Real signed transfers, not simulated ones.
          </h2>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-8 leading-relaxed">
            The outbound signer refuses to fabricate a transaction hash — no signer configured
            means no payout, ever, never a simulated success. On Base Sepolia testnet we created,
            approved, and submitted a real payout end to end: signed, broadcast, and confirmed
            on-chain, with a second identical request correctly deduplicated rather than sending
            twice.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
