import Link from 'next/link';
import { Check } from 'lucide-react';

const PLANS = [
  {
    name: 'Starter',
    monthlyFee: '$0',
    monthlyNote: 'No platform fee',
    transactionFee: '2.9% + $0.30',
    transactionNote: 'per fiat transaction',
    highlight: false,
    description: 'Get started with no monthly commitment.',
    features: [
      'Cards, ACH, SEPA',
      'Stablecoin & crypto (1.4% + gas)',
      'Hosted checkout',
      'Basic webhooks',
      'Email support',
    ],
    cta: 'Start free',
    ctaHref: '/signup',
  },
  {
    name: 'Growth',
    monthlyFee: '$5',
    monthlyNote: 'per month',
    transactionFee: '2.2% + $0.20',
    transactionNote: 'per fiat transaction',
    highlight: true,
    description: 'Lower transaction fees from your first payment.',
    features: [
      'Everything in Starter',
      'Merchant of Record (global tax)',
      'Subscriptions & usage billing',
      'Smart payment routing',
      'AI/agent payments (x402)',
      'Advanced webhooks + retry',
      'Priority support',
    ],
    cta: 'Start growing',
    ctaHref: '/signup?plan=growth',
  },
  {
    name: 'Enterprise',
    monthlyFee: 'Custom',
    monthlyNote: 'volume discounts',
    transactionFee: 'Custom',
    transactionNote: 'negotiated rate',
    highlight: false,
    description: 'High volume, custom routing, dedicated infra.',
    features: [
      'Everything in Growth',
      'Self-hosting option',
      'Custom connectors',
      'Dedicated Slack channel',
      'SLA with penalties',
      'Custom compliance reports',
      'Onboarding engineer',
    ],
    cta: 'Talk to us',
    ctaHref: '/contact',
  },
];

const COMPARE_ROWS = [
  { item: 'Card fee',            forgepay: '2.2% + $0.20',   stripe: '2.9% + $0.30', paddle: '5% + $0.50' },
  { item: 'Stablecoin fee',      forgepay: '1.4% + gas',      stripe: 'N/A',           paddle: 'N/A' },
  { item: 'Crypto fee',          forgepay: '1.4% + gas',      stripe: 'N/A',           paddle: 'N/A' },
  { item: 'MoR tax handling',    forgepay: 'Included',        stripe: 'Extra',         paddle: 'Yes (at 5%+)' },
  { item: 'Advanced billing',    forgepay: 'Included',        stripe: 'Extra $$$',     paddle: 'Limited' },
  { item: 'AI/agent payments',   forgepay: 'Native (x402)',   stripe: 'No',            paddle: 'No' },
  { item: 'Smart routing',       forgepay: 'Included',        stripe: 'No',            paddle: 'No' },
  { item: 'Self-hosting',        forgepay: 'Enterprise tier', stripe: 'No',            paddle: 'No' },
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
            More features.{' '}
            <span className="text-cyan-500">Lower cost.</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            ForgePay costs less than Stripe at every volume, and includes global tax, advanced billing,
            and stablecoin support that Stripe charges extra for — or doesn&apos;t offer at all.
          </p>
        </div>

        {/* Pricing cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
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
