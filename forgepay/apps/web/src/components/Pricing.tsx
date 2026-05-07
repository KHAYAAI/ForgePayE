import Link from 'next/link';
import { Check } from 'lucide-react';
import { PRICING } from '@/lib/pricing';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    monthlyFee: PRICING.tiers.free.monthlyFee,
    monthlyNote: PRICING.tiers.free.monthlyFeeLabel,
    transactionFee: PRICING.tiers.free.transaction_fees.card,
    transactionNote: 'per card transaction',
    highlight: false,
    description: 'Perfect for getting started with ForgePay.',
    features: [
      'Card payments (Visa, Mastercard, Amex)',
      `Stablecoin & crypto (${PRICING.tiers.free.transaction_fees.stablecoin})`,
      'Hosted checkout',
      'Basic analytics',
      'Up to $25k monthly volume',
      'Community support',
      'Webhook infrastructure',
    ],
    cta: 'Start free',
    ctaHref: '/signup',
  },
  {
    id: 'standard',
    name: 'Standard',
    monthlyFee: PRICING.tiers.standard.monthlyFee,
    monthlyNote: PRICING.tiers.standard.monthlyFeeLabel,
    transactionFee: PRICING.tiers.standard.transaction_fees.card,
    transactionNote: 'per card transaction',
    highlight: true,
    description: 'For scaling merchants who need compliance and control.',
    features: [
      'All Free features',
      'Unlimited monthly volume',
      'Merchant of Record (200+ jurisdictions)',
      'Automatic tax calculation & filing',
      'Subscriptions & usage-based billing',
      'Advanced analytics & reporting',
      'Priority support (2h response)',
      'Team members (up to 10)',
      'Dunning & chargeback management',
    ],
    cta: 'Get started',
    ctaHref: '/signup?plan=standard',
  },
];

const COMPARE_ROWS = [
  { item: 'Card payments (Free)',    forgepay: '2.8% + $0.24',  stripe: '2.9% + $0.30', paddle: '5% + $0.50' },
  { item: 'Card payments (Standard)', forgepay: '2.4% + $0.24',  stripe: '2.9% + $0.30', paddle: '5% + $0.50' },
  { item: 'Monthly platform fee',   forgepay: '$0 (Free) / $28 (Standard)', stripe: '$0', paddle: '$0' },
  { item: 'Stablecoin & crypto',    forgepay: 'Native 1.8%/1.4%', stripe: 'N/A', paddle: 'N/A' },
  { item: 'Merchant of Record',     forgepay: 'Standard tier', stripe: 'Not offered', paddle: 'Yes (5%+)' },
  { item: 'Tax in 200+ jurisdictions', forgepay: 'Included (Standard)', stripe: 'N/A', paddle: 'N/A' },
  { item: 'Subscriptions & billing', forgepay: 'Included',        stripe: 'Extra $$$',     paddle: 'Limited' },
  { item: 'x402 agent payments',    forgepay: 'Native',        stripe: 'No',            paddle: 'No' },
];

export default function Pricing() {
  return (
    <section id="pricing" className="py-24 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-16">
          <div className="inline-block bg-cyan-500/10 border border-cyan-500/20 rounded-full px-4 py-1 text-xs font-semibold text-cyan-400 uppercase tracking-wide mb-4">
            Transparent pricing
          </div>
          <h2 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight">
            Start free.{' '}
            <span className="text-cyan-500">Upgrade when you grow.</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            Begin with zero monthly fees and accept payments immediately — cards, stablecoins, and crypto.
            Upgrade to Standard for automatic tax compliance across 200+ jurisdictions when you need it.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20 max-w-3xl mx-auto">
          {PLANS.map((plan) => (
            <div
              key={plan.name}
              className={`relative rounded-2xl p-8 flex flex-col ${
                plan.highlight
                  ? 'bg-navy-700/60 border-2 border-cyan-500/60 glow-cyan'
                  : 'border border-white/10 bg-white/[0.02]'
              }`}
            >
              {plan.highlight && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-cyan-500 text-navy-800 text-xs font-black px-4 py-1 rounded-full uppercase tracking-wide">
                  Most popular
                </div>
              )}

              <div className="mb-6">
                <h3 className="text-lg font-bold text-white mb-1">{plan.name}</h3>
                <p className="text-sm text-gray-400">{plan.description}</p>
              </div>

              {/* Monthly fee */}
              <div className="mb-2">
                <span className="text-4xl font-black text-white">{plan.monthlyFee}</span>
                <span className="text-gray-400 text-sm ml-1">{plan.monthlyNote}</span>
              </div>

              {/* Transaction fee */}
              <div className="mb-8 pb-8 border-b border-white/10">
                <span className="text-lg font-bold text-cyan-400">{plan.transactionFee}</span>
                <span className="text-gray-500 text-sm ml-1">{plan.transactionNote}</span>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f) => (
                  <li key={f} className="flex items-start gap-2.5 text-sm text-gray-300">
                    <Check size={14} className="text-cyan-400 shrink-0 mt-0.5" />
                    {f}
                  </li>
                ))}
              </ul>

              <Link
                href={plan.ctaHref}
                className={`w-full text-center font-bold py-3.5 rounded-xl text-sm transition-all duration-200 ${
                  plan.highlight
                    ? 'bg-cyan-500 hover:bg-cyan-400 text-navy-800'
                    : 'border border-white/20 hover:border-cyan-500/40 text-white hover:bg-white/5'
                }`}
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>

        {/* Comparison table */}
        <div>
          <h3 className="text-xl font-bold text-center mb-8 text-white">
            How ForgePay compares
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-gray-400 font-medium w-1/4">Feature</th>
                  <th className="py-3 px-4 text-cyan-400 font-bold">ForgePay</th>
                  <th className="py-3 px-4 text-gray-400 font-medium">Stripe</th>
                  <th className="py-3 px-4 text-gray-400 font-medium">Paddle</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row, i) => (
                  <tr key={row.item} className={i % 2 === 0 ? 'bg-white/[0.01]' : ''}>
                    <td className="py-3 px-4 text-gray-300">{row.item}</td>
                    <td className="py-3 px-4 text-center text-cyan-300 font-medium">{row.forgepay}</td>
                    <td className="py-3 px-4 text-center text-gray-400">{row.stripe}</td>
                    <td className="py-3 px-4 text-center text-gray-400">{row.paddle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
