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

const FEATURES = [
  {
    icon: CreditCard,
    title: 'Fiat Payments',
    description:
      'Cards, ACH, SEPA, bank transfers. 100+ processors via smart routing. Best approval rates, lowest cost.',
    tag: '2% + $0.20',
  },
  {
    icon: Coins,
    title: 'Stablecoins',
    description:
      'USDC, USDT, EURC on Ethereum, Base, Polygon, Arbitrum, and Solana. Near-instant settlement.',
    tag: '1.4% + gas',
  },
  {
    icon: Bitcoin,
    title: 'Crypto Payments',
    description:
      'BTC, ETH, and 50+ coins. Invoice-based with QR codes, automatic exchange rates, and on-chain confirmation tracking.',
    tag: '1.4% + gas',
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
    <section id="features" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-16">
          <div className="inline-block bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1 text-xs font-semibold text-cyan-400 uppercase tracking-wide mb-4">
            Everything included
          </div>
          <h2 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight">
            One platform.{' '}
            <span className="text-cyan-500">Every payment type.</span>
          </h2>
          <p className="text-lg text-gray-400 max-w-2xl mx-auto">
            Stop juggling Stripe, Paddle, and a crypto processor. ForgePay handles everything in a
            single integration — with built-in tax, billing, and AI-native features.
          </p>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="group relative border-gradient rounded-2xl p-6 hover:bg-white/[0.03] transition-all duration-300 hover:scale-[1.01]"
              >
                {/* Icon */}
                <div className="w-10 h-10 bg-cyan-500/10 rounded-lg flex items-center justify-center mb-4 group-hover:bg-cyan-500/20 transition-colors">
                  <Icon size={20} className="text-cyan-400" />
                </div>

                {/* Title + Tag */}
                <div className="flex items-start justify-between mb-2 gap-2">
                  <h3 className="text-base font-bold text-white">{feature.title}</h3>
                  <span className="shrink-0 text-[10px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full px-2 py-0.5 mt-0.5">
                    {feature.tag}
                  </span>
                </div>

                {/* Description */}
                <p className="text-sm text-gray-400 leading-relaxed">{feature.description}</p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
