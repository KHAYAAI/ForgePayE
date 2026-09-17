/**
 * ARCH: Platform overview — new page.
 * ──────────────────────────────────────────────────────────────────────────────
 * Full-platform map across all 25 services in the monorepo, grouped honestly
 * by what's actually true of each: PROVEN (verified live this testnet cycle),
 * BUILDING (real code, not yet exercised end-to-end), and EARLY (scaffolding
 * -- routes and tests barely exist). That maturity data came from a direct
 * survey of each service's package.json, route count, and test count, not
 * from guessing at directory names.
 *
 * Deliberately does not invent capabilities or metrics for anything in the
 * BUILDING/EARLY tiers -- see the "not on this page" note in EARLY_STAGE.
 */

'use client';

import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';

type Tier = 'proven' | 'building' | 'early';

interface Product {
  name: string;
  tagline: string;
  href?: string;
  tier: Tier;
}

const CORE: Product[] = [
  {
    name: 'FORGE Credit Bureau',
    tagline:
      'Dual-mode credit scoring for autonomous agents, settled on-chain, with automatic furnisher revenue share.',
    href: '/products/credit-bureau',
    tier: 'proven',
  },
  {
    name: 'Payments Infrastructure',
    tagline:
      'USDC/USDT rails across EVM chains and Solana, x402 micropayments, crypto invoicing.',
    href: '/products/payments',
    tier: 'proven',
  },
];

const AGENT_PRIMITIVES: Product[] = [
  {
    name: 'Agent Credit Lines',
    tagline: 'Net-30/60/90 credit issuance, auto-settlement, and default tracking for AI agents.',
    tier: 'building',
  },
  {
    name: 'Agent Identity Registry',
    tagline: 'DID-based agent identities, reputation, and attestations.',
    tier: 'building',
  },
  {
    name: 'Agent Decision Framework',
    tagline: 'Policy-based approval logic and counterparty trust scoring for autonomous transactions.',
    tier: 'building',
  },
  {
    name: 'Agent Negotiation Protocol',
    tagline: 'Offer/counter-offer, escrow, and settlement between agents.',
    tier: 'building',
  },
  {
    name: 'Agent Liquidity Manager',
    tagline: 'Multi-asset agent portfolios — auto-sweep, auto-liquidate, rebalancing.',
    tier: 'building',
  },
];

const TREASURY_CUSTODY: Product[] = [
  {
    name: 'Enterprise Treasury',
    tagline: 'Multi-account consolidation, rules engine, and intercompany netting.',
    href: '/products/treasury',
    tier: 'building',
  },
  {
    name: 'FORGE Custody',
    tagline: 'Institutional digital-asset custody and threshold signing, built on the open-source OpenFireblocks project.',
    tier: 'building',
  },
  {
    name: 'FORGE Wallet',
    tagline: 'Wallet-as-a-service and identity layer for consumers and agents, built on the open-source OpenPrivy project.',
    tier: 'building',
  },
  {
    name: 'Bank Connectivity',
    tagline: 'Bank account linking via Plaid (US) and Open Banking (EU/UK), with ACH/SEPA transfer initiation.',
    tier: 'building',
  },
  {
    name: 'Bank White-Label',
    tagline: 'Multi-tenant bank admin console, customer management, and settlement reporting.',
    tier: 'building',
  },
  {
    name: 'Institutional Reporting',
    tagline: 'CFO/auditor-ready financial reports, tax filings, SOX audit trails.',
    tier: 'building',
  },
  {
    name: 'Yield Engine',
    tagline: 'Auto-sweeps idle stablecoin balances into Aave, Compound, and Ondo vaults.',
    tier: 'building',
  },
  {
    name: 'RWA Registry',
    tagline: 'Registry for tokenized real-world assets.',
    tier: 'building',
  },
  {
    name: 'Accounts Service',
    tagline: 'Stablecoin-backed USD/USDC wallets — deposits, withdrawals, KYC/AML.',
    tier: 'building',
  },
];

const INFRASTRUCTURE: Product[] = [
  {
    name: 'Compliance Monitor',
    tagline: 'OFAC and EU sanctions screening, the fail-closed layer behind the Credit Bureau and payment rails.',
    tier: 'proven',
  },
  {
    name: 'Unified Router',
    tagline: 'Normalizes events from every service into a single canonical stream.',
    tier: 'building',
  },
  {
    name: 'Chain Sync',
    tagline: 'Polls on-chain ZK contract state across EVM chains.',
    tier: 'building',
  },
  {
    name: 'Billing Engine',
    tagline: 'Subscription and usage billing, built on the open-source Kill Bill platform.',
    tier: 'building',
  },
  {
    name: 'Liquidity Forecaster',
    tagline: 'Forecasting for treasury liquidity positions.',
    tier: 'early',
  },
];

const EARLY_STAGE_NOTE =
  "A few services — the shielded-payments auditor layer, transactional email, and the standalone " +
  "OpenFireblocks integration shell — are still mostly directory structure: little to no working " +
  "code behind them yet. Rather than invent a description for something that doesn't function, " +
  "they're named here and nowhere else on the site until that changes.";

function TierBadge({ tier }: { tier: Tier }) {
  const styles: Record<Tier, string> = {
    proven: 'text-[#39D353] border-[#39D353]',
    building: 'text-[#F59E0B] border-[#F59E0B]',
    early: 'text-[#6B7280] border-[#1E1E1E]',
  };
  const labels: Record<Tier, string> = {
    proven: 'LIVE — TESTNET PROVEN',
    building: 'IN DEVELOPMENT',
    early: 'EARLY / COMING SOON',
  };
  return (
    <span className={`text-[9px] font-mono tracking-widest border px-2 py-0.5 ${styles[tier]}`}>
      {labels[tier]}
    </span>
  );
}

function ProductCard({ product }: { product: Product }) {
  const Wrapper = product.href ? Link : 'div';
  const wrapperProps = product.href ? { href: product.href } : {};
  return (
    <Wrapper
      {...(wrapperProps as any)}
      className={`block bg-[#111111] p-5 border border-[#1E1E1E] transition-colors duration-200 ${
        product.href ? 'hover:border-[#39D35330] cursor-pointer' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <h3 className="text-sm font-mono font-bold text-white tracking-tight">{product.name}</h3>
        <TierBadge tier={product.tier} />
      </div>
      <p className="text-xs font-mono text-[#6B7280] leading-relaxed">{product.tagline}</p>
      {product.href && (
        <p className="text-[10px] font-mono text-[#39D353] mt-3 tracking-wider">VIEW PRODUCT →</p>
      )}
    </Wrapper>
  );
}

function Section({
  label,
  title,
  description,
  products,
}: {
  label: string;
  title: string;
  description?: string;
  products: Product[];
}) {
  return (
    <section className="py-16 px-8 border-t border-[#1A1A1A]">
      <div className="max-w-7xl mx-auto">
        <div className="mb-10">
          <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">// {label}</p>
          <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-3 tracking-tight">
            {title}
          </h2>
          {description && (
            <p className="text-sm font-mono text-[#6B7280] max-w-2xl leading-relaxed">
              {description}
            </p>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[#1E1E1E]">
          {products.map((p) => (
            <ProductCard key={p.name} product={p} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function PlatformPage() {
  return (
    <main className="min-h-screen bg-forge-bg">
      <Navbar />

      {/* Hero */}
      <section className="relative pt-32 pb-16 px-8 overflow-hidden">
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
              // THE FULL PLATFORM
            </span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold font-mono tracking-tight leading-[1.1] mb-6 text-white">
            Financial infrastructure for<br />
            <span className="text-[#6B7280]">autonomous agents.</span>
          </h1>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl leading-relaxed">
            Two products carry real transaction volume today, verified end to end on testnet. The
            rest of this page is the platform being built around them — shown honestly, at the
            stage it's actually at, not the stage we'd like it to be at.
          </p>
        </div>
      </section>

      <Section
        label="CORE — LIVE TODAY"
        title="Proven, not promised."
        description="These two carry the entire, real, on-chain-verified money path — not a demo."
        products={CORE}
      />

      <Section
        label="AGENT FINANCIAL PRIMITIVES"
        title="What an agent needs to actually hold and move credit."
        description="Real code, in active development. Not yet exercised end-to-end the way the Core products have been."
        products={AGENT_PRIMITIVES}
      />

      <Section
        label="TREASURY, CUSTODY & BANKING"
        title="Where the money actually lives."
        description="Institutional-grade rails — custody, treasury, banking connectivity, yield — in active development."
        products={TREASURY_CUSTODY}
      />

      <Section
        label="PLATFORM INFRASTRUCTURE"
        title="What runs underneath everything else."
        products={INFRASTRUCTURE}
      />

      <section className="py-16 px-8 border-t border-[#1A1A1A]">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-mono text-[#6B7280] tracking-widest mb-3">// A NOTE ON HONESTY</p>
          <p className="text-sm font-mono text-[#6B7280] leading-relaxed">{EARLY_STAGE_NOTE}</p>
        </div>
      </section>

      <Footer />
    </main>
  );
}
