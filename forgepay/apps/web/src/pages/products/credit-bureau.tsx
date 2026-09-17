/**
 * ARCH: FORGE Credit Bureau — product page
 * ──────────────────────────────────────────────────────────────────────────────
 * Rebuilt to match the site's actual design system (forge.bg/#39D353 green/
 * JetBrains Mono — see Hero.tsx, Features.tsx) instead of the generic
 * purple/pink gradient this page previously shipped with. Content is grounded
 * in what the platform actually does and what has actually been verified —
 * see the "proven, not promised" section below — not aspirational copy.
 *
 * Pricing numbers are pulled from services/agent-credit-bureau/src/plans.ts
 * directly (four tiers: Observer/Growth/Institutional/Network). If that file
 * changes, this page goes stale — there is no shared source of truth between
 * the pricing engine and the marketing site yet.
 */

'use client';

import Link from 'next/link';
import { Scale, Link2, ShieldCheck, Users } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

const HOW_IT_WORKS = [
  {
    icon: Scale,
    step: '01',
    title: 'Mode 1 — off-chain scoring',
    description:
      'Every pull is scored instantly from payment history (40%), transaction volume (30%), account age (20%), and risk profile (10%). Sub-15ms — no blockchain write sits on the hot path.',
  },
  {
    icon: Link2,
    step: '02',
    title: 'Mode 2 — on-chain settlement',
    description:
      'Operational reputation — success rate, volume, compliance signals, account age — settles daily to ForgeReputationRegistry on Base. A lender reads a tamper-evident score history, not a black-box number.',
  },
  {
    icon: ShieldCheck,
    step: '03',
    title: 'Sanctions screening, every pull',
    description:
      'OFAC and EU consolidated-list screening runs on every report before it issues. Fails closed by design: an unreachable compliance service means no report, never a silent pass.',
  },
  {
    icon: Users,
    step: '04',
    title: 'Furnishers earn automatically',
    description:
      'The lending protocols and gateways whose data informed a report earn 25% of the inquiry fee — paid in USDC, automatically, per pull. No manual reconciliation, no revenue-share disputes.',
  },
];

const PLANS = [
  {
    name: 'Observer',
    price: '$0',
    period: '/mo',
    tagline: 'Access gating and offer sizing, where a grade band is enough.',
    features: [
      'Unlimited soft pulls — grade band only',
      'Published grade scale and bureau statistics',
      'Simulation endpoint (records no inquiry)',
    ],
    cta: 'Start free',
  },
  {
    name: 'Growth',
    price: '$1,000',
    period: '/mo',
    tagline: 'Fintechs, smaller lending protocols and agent marketplaces.',
    features: [
      'Everything in Observer',
      '250 hard inquiries/year included',
      'Full reports, dual-mode scores and consensus',
      'Dispute filing and standard support',
    ],
    cta: 'Get started',
  },
  {
    name: 'Institutional',
    price: '$4,000',
    period: '/mo',
    tagline: 'Banks, insurers and lending protocols underwriting at volume.',
    features: [
      'Everything in Growth',
      '2,500 hard inquiries/year included',
      'Zero-knowledge threshold proofs',
      'Priority disputes with a contractual SLA',
    ],
    cta: 'Talk to sales',
    featured: true,
  },
  {
    name: 'Network',
    price: '$12,000',
    period: '/mo floor',
    tagline: 'Bank white-label partners and multi-entity financial groups.',
    features: [
      'Everything in Institutional',
      '10,000 hard inquiries/year included',
      'White-label terms, multi-entity access',
      'Custom SLAs, dedicated onboarding',
    ],
    cta: 'Talk to sales',
  },
];

export default function CreditBureauPage() {
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
              // AGENT CREDIT INFRASTRUCTURE
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold font-mono tracking-tight leading-[1.1] mb-6">
            <span className="text-white">The first credit bureau</span>
            <span className="text-[#39D353] animate-blink">_</span>
            <br />
            <span className="text-[#6B7280]">for autonomous agents.</span>
          </h1>

          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-3 leading-relaxed">
            Dual-mode credit scoring — instant off-chain, settled on-chain — so a lender can
            underwrite an AI agent the way they'd underwrite anyone else: on a real, verifiable
            history.
          </p>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-12 leading-relaxed">
            Every report is sanctions-screened. Every furnisher gets paid automatically. Every
            score settles to Base.
          </p>

          <div className="flex flex-row items-center gap-4">
            <Link
              href="/checkout/credit-bureau"
              className="text-[#39D353] text-xs font-mono border border-[#39D353] px-6 py-2.5 hover:bg-[#39D35310] transition-colors tracking-wider glow-green"
            >
              PULL YOUR FIRST REPORT →
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

      {/* How it works */}
      <section className="py-20 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// HOW IT WORKS</p>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-3 tracking-tight">
              One pull, four things happen.
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-px bg-[#1E1E1E]">
            {HOW_IT_WORKS.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.step}
                  className="bg-[#111111] p-6 border border-[#1E1E1E] hover:border-[#39D35330] transition-colors duration-200"
                >
                  <div className="flex items-center justify-between mb-4">
                    <Icon size={16} className="text-[#39D353]" />
                    <span className="text-[10px] font-mono text-[#6B7280] tracking-widest">
                      {item.step}
                    </span>
                  </div>
                  <h3 className="text-sm font-mono font-bold text-white mb-2 tracking-tight">
                    {item.title}
                  </h3>
                  <p className="text-xs font-mono text-[#6B7280] leading-relaxed">
                    {item.description}
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
            The full money path, tested end to end.
          </h2>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl mb-8 leading-relaxed">
            Before this went anywhere near real funds, we ran the entire path on Base Sepolia
            testnet: a real report pull, sanctions screening, correct furnisher attribution, and
            an actual signed USDC transfer that confirmed on-chain — with idempotency and
            restart-survival verified, not assumed. Mainnet deployment follows the same,
            deliberately mechanical runbook.
          </p>
          <div className="flex flex-wrap gap-3">
            {['Report → attribution → settlement, verified live', 'Idempotent — a retried payout never sends twice', 'Restart-survival proven, not assumed'].map((claim) => (
              <span
                key={claim}
                className="text-[11px] font-mono text-[#6B7280] border border-[#1E1E1E] bg-[#111111] px-3 py-1.5"
              >
                {claim}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-7xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// PRICING</p>
            <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-3 tracking-tight">
              Priced for who's actually buying.
            </h2>
            <p className="text-sm font-mono text-[#6B7280] max-w-2xl">
              No subscription required — pay-as-you-go hard pulls start at $2.80, dropping to
              $2.00 at volume. Furnishers earn a fixed 25% of list on every pull regardless of the
              buyer's discount.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-px bg-[#1E1E1E]">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`bg-[#111111] p-6 border flex flex-col ${
                  plan.featured ? 'border-[#39D353]' : 'border-[#1E1E1E]'
                }`}
              >
                {plan.featured && (
                  <span className="text-[10px] font-mono text-[#39D353] tracking-widest mb-3">
                    MOST COMMON
                  </span>
                )}
                <h3 className="text-sm font-mono font-bold text-white mb-1 tracking-tight">
                  {plan.name}
                </h3>
                <div className="mb-3">
                  <span className="text-2xl font-mono font-bold text-white">{plan.price}</span>
                  <span className="text-xs font-mono text-[#6B7280]">{plan.period}</span>
                </div>
                <p className="text-xs font-mono text-[#6B7280] mb-6 leading-relaxed">
                  {plan.tagline}
                </p>
                <ul className="space-y-2 mb-8 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="text-[11px] font-mono text-[#6B7280] flex gap-2">
                      <span className="text-[#39D353]">&gt;</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={`/checkout/credit-bureau?tier=${plan.name.toLowerCase()}`}
                  className={`text-center text-xs font-mono px-4 py-2.5 tracking-wider transition-colors ${
                    plan.featured
                      ? 'text-[#39D353] border border-[#39D353] hover:bg-[#39D35310]'
                      : 'text-[#6B7280] border border-[#1E1E1E] hover:text-white hover:border-[#333]'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </main>
  );
}
