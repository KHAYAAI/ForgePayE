'use client';

import Link from 'next/link';

export default function PaymentsPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold mb-4">FORGE Payments</h1>
          <p className="text-xl mb-8">
            Payment processing that's 40% cheaper than Stripe, with instant settlements
          </p>
          <Link
            href="/checkout/payments?tier=growth"
            className="inline-block px-8 py-3 bg-white text-blue-600 font-semibold rounded-lg hover:bg-gray-100"
          >
            Start Free Trial
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold mb-12 text-center">Why FORGE?</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            { title: 'Lower Fees', desc: '1.2% + R5/tx vs Stripe 2.9% + R2/tx' },
            { title: 'Instant Settlements', desc: 'Daily payouts to your bank account' },
            { title: 'Multi-Currency', desc: 'ZAR, USD, EUR, plus crypto support' },
          ].map((feature, i) => (
            <div key={i} className="p-6 border border-gray-200 rounded-lg">
              <h3 className="font-bold text-lg mb-2">{feature.title}</h3>
              <p className="text-gray-600">{feature.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section className="bg-gray-50 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold mb-12 text-center">Simple Pricing</h2>
          <div className="grid md:grid-cols-2 gap-8">
            {[
              { name: 'Free', price: '0', desc: '14-day trial, then free forever' },
              { name: 'Growth', price: '15K/mo', desc: 'Best for scaling businesses' },
            ].map((plan, i) => (
              <div key={i} className="bg-white p-8 rounded-lg border border-gray-200">
                <h3 className="text-2xl font-bold mb-2">R{plan.price}</h3>
                <p className="text-gray-600 mb-4">{plan.desc}</p>
                <Link
                  href={`/checkout/payments?tier=${i === 0 ? 'free' : 'growth'}`}
                  className="inline-block px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                >
                  Choose
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
