import {
  CreditCard,
  Coins,
  Bitcoin,
  Globe,
  BarChart3,
  Zap,
  Shield,
  ArrowLeftRight,
  Bot,
} from 'lucide-react';
import { PRICING } from '@/lib/pricing';

const FEATURES = [
  {
    icon: CreditCard,
    title: 'Fiat Payments',
    description:
      'Cards, ACH, SEPA, bank transfers. 100+ processors via smart routing. Best approval rates, lowest cost.',
    tag: PRICING.card.fee,
  },
  {
    icon: Coins,
    title: 'Stablecoins',
    description:
      'USDC, USDT, EURC on Ethereum, Base, Polygon, Arbitrum, and Solana. Near-instant settlement.',
    tag: PRICING.stablecoin.fee,
  },
  {
    icon: Bitcoin,
    title: 'Crypto Payments',
    description:
      'BTC, ETH, and 50+ coins. Invoice-based with QR codes, automatic exchange rates, and on-chain confirmation tracking.',
    tag: PRICING.crypto.fee,
  },
  {
    icon: Globe,
    title: 'Merchant of Record',
    description:
      'We handle all global taxes — VAT, GST, sales tax. Automatic calculation, collection, and remittance in 200+ countries.',
    tag: 'Included',
  },
  {
    icon: BarChart3,
    title: 'Advanced Billing',
    description:
      'Subscriptions, usage metering, credits, entitlements, dunning, and invoices. Built for AI, SaaS, and token-based products.',
    tag: 'Included',
  },
  {
    icon: ArrowLeftRight,
    title: 'Smart Routing',
    description:
      'AI-powered routing across processors. Optimizes for cost, speed, and success rate. Automatic retry on failure.',
    tag: 'Included',
  },
  {
    icon: Bot,
    title: 'AI & Agent Payments',
    description:
      'Native x402 protocol support. Let AI agents pay and get paid programmatically without human intervention.',
    tag: 'Native',
  },
  {
    icon: Shield,
    title: 'PCI Vault + Security',
    description:
      'Cards never touch your servers. Hyperswitch vault handles tokenization. HMAC-signed webhooks. SOC 2 ready.',
    tag: 'Level 1 PCI',
  },
  {
    icon: Zap,
    title: 'One API',
    description:
      'Single unified REST API for every payment type. JS, Python, and Rust SDKs. Idempotent. WebSocket real-time events.',
    tag: 'OpenAPI 3.1',
  },
];

export default function Features() {
  return (
    <section id="features" className="py-24 px-8">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="mb-12">
          <p className="text-xs font-mono text-[#39D353] tracking-widest mb-3">
            // PLATFORM CAPABILITIES
          </p>
          <h2 className="text-2xl sm:text-3xl font-mono font-bold text-white mb-3 tracking-tight">
            One platform. Every payment type.
          </h2>
          <p className="text-sm font-mono text-[#6B7280] max-w-2xl">
            Stop juggling Stripe, Paddle, and a crypto processor. ForgePay handles everything in a
            single integration — with built-in tax, billing, and AI-native features.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-[#1E1E1E]">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group bg-[#111111] p-6 border border-[#1E1E1E] hover:border-[#39D35330] transition-colors duration-200 cursor-default"
              >
                {/* Icon row */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-[#39D353] text-xs font-mono">&gt;</span>
                    <Icon size={14} className="text-[#39D353]" />
                  </div>
                  <span className="text-[10px] font-mono text-[#6B7280] border border-[#1E1E1E] px-2 py-0.5 tracking-wider">
                    {feature.tag}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-sm font-mono font-bold text-white mb-2 tracking-tight">
                  {feature.title}
                </h3>

                {/* Description */}
                <p className="text-xs font-mono text-[#6B7280] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
