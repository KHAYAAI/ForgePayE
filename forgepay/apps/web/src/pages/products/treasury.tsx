'use client';

import Link from 'next/link';

export default function TreasuryPage() {
  return (
    <div className="min-h-screen bg-white">
      <section className="bg-gradient-to-r from-green-600 to-emerald-600 text-white py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold mb-4">FORGE Treasury</h1>
          <p className="text-xl mb-8">
            Automate agent payouts with daily netting and multi-currency settlement
          </p>
          <Link
            href="/checkout/treasury"
            className="inline-block px-8 py-3 bg-white text-green-600 font-semibold rounded-lg hover:bg-gray-100"
          >
            Start Free Trial
          </Link>
        </div>
      </section>

      <section className="py-16 px-4 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold mb-12 text-center">Features</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { title: 'Daily Netting', desc: 'Automatic settlement of agent payouts at 22:00 UTC' },
            { title: 'OFAC Screening', desc: 'Built-in sanctions compliance checks' },
            { title: 'Multi-Asset', desc: 'USDC, USDT, stablecoins, with FX conversion' },
          ].map((feature, i) => (
            <div key={i} className="p-6 border border-gray-200 rounded-lg">
              <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
              <p className="text-gray-600">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-gray-50 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-8">R40K / month</h2>
          <p className="text-gray-600 mb-8 text-lg">
            14-day free trial included. Save R3.5K/mo when bundled with Credit Bureau.
          </p>
          <Link
            href="/checkout/bundle?products=treasury,credit-bureau"
            className="inline-block px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 mr-4"
          >
            See Bundle Pricing
          </Link>
          <Link
            href="/checkout/treasury"
            className="inline-block px-8 py-3 border border-green-600 text-green-600 font-semibold rounded-lg hover:bg-green-50"
          >
            Treasury Only
          </Link>
        </div>
      </section>
    </div>
  );
}
