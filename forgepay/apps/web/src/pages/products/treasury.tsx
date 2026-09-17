/**
 * ARCH: FORGE Treasury — product page.
 * ──────────────────────────────────────────────────────────────────────────────
 * Previously the same generic light-mode style as the other two product pages,
 * with an invented "R40K/month" price that corresponds to nothing real. This
 * cluster (Enterprise Treasury, Custody, Wallet, Bank Connectivity, Yield
 * Engine, Institutional Reporting) is IN DEVELOPMENT, not proven end-to-end
 * the way Credit Bureau and Payments are -- so unlike those two pages, this
 * one has no "proven, not promised" section and no invented pricing. It
 * describes real code honestly, without claiming a maturity it doesn't have.
 */

'use client';

import Link from 'next/link';
import { Landmark, ShieldCheck, Wallet, Building2, FileBarChart, TrendingUp } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const CAPABILITIES = [
  {
    icon: Landmark,
    title: 'Enterprise Treasury',
    description:
      'Multi-account consolidation, a rules engine, and intercompany netting — for organizations managing balances across multiple entities and currencies.',
  },
  {
    icon: ShieldCheck,
    title: 'Institutional Custody',
    description:
      'Digital-asset custody with threshold signing, built on the open-source OpenFireblocks project. No single key controls funds alone.',
  },
  {
    icon: Wallet,
    title: 'Wallet-as-a-Service',
    description:
      'Embedded wallet infrastructure and identity layer for consumers and agents, built on the open-source OpenPrivy project.',
  },
  {
    icon: Building2,
    title: 'Bank Connectivity',
    description:
      'Bank account linking via Plaid (US) and Open Banking (EU/UK), with ACH and SEPA transfer initiation. Plus a white-label console for banks that want to offer these rails under their own brand.',
  },
  {
    icon: TrendingUp,
    title: 'Yield Engine',
    description:
      'Auto-sweeps idle stablecoin balances into Aave, Compound, and Ondo vaults, so treasury cash isn\'t sitting idle by default.',
  },
  {
    icon: FileBarChart,
    title: 'Institutional Reporting',
    description:
      'CFO- and auditor-ready financial reports, tax filings, and SOX audit trails.',
  },
];

export default function TreasuryPage() {
  return (
    <main className="min-h-screen bg-forge-bg">
      <Navbar />

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
            <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] inline-block" />
            <span className="text-[10px] font-mono text-[#6B7280] tracking-widest uppercase">
              // TREASURY, CUSTODY &amp; BANKING — IN DEVELOPMENT
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-mono tracking-tight leading-[1.1] mb-6">
            <span className="text-white">Where the money</span>
            <br />
            <span className="text-[#6B7280]">actually lives.</span>
          </h1>

          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-12 leading-relaxed">
            Institutional-grade custody, treasury operations, bank connectivity, and reporting —
            being built alongside the Credit Bureau and Payments rails, not yet carrying the same
            testnet-verified track record. If you want early access or want to shape the roadmap,
            talk to us directly.
          </p>

          <div className="flex flex-row items-center gap-4">
            <Link
              href="/contact"
              className="text-[#39D353] text-xs font-mono border border-[#39D353] px-6 py-2.5 hover:bg-[#39D35310] transition-colors tracking-wider glow-green"
            >
              TALK TO US →
            </Link>
            <Link
              href="/platform"
              className="text-[#6B7280] text-xs font-mono border border-[#1E1E1E] px-6 py-2.5 hover:text-white hover:border-[#333] transition-colors tracking-wider"
            >
              SEE THE FULL PLATFORM
            </Link>
          </div>
        </div>
      </section>

      <section className="py-20 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// CAPABILITIES</p>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-3 tracking-tight">
              What's being built.
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

      <section className="py-20 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-mono text-[#6B7280] tracking-widest mb-3">// PRICING</p>
          <h2 className="text-xl font-mono font-bold text-white mb-4 tracking-tight">
            Not published yet.
          </h2>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl leading-relaxed">
            This cluster isn't at the stage where a self-serve price makes sense — custody and
            banking connectivity are the kind of product institutional buyers negotiate directly.
            If you're evaluating this for your organization, reach out and we'll scope it with you.
          </p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
