'use client';

import Link from 'next/link';

export default function CreditBureauPage() {
  return (
    <div className="min-h-screen bg-white">
      <section className="bg-gradient-to-r from-purple-600 to-pink-600 text-white py-20">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-5xl font-bold mb-4">FORGE Credit Bureau</h1>
          <p className="text-xl mb-8">
            Real-time agent credit scoring + on-chain settlement + 25% partner revenue
          </p>
          <Link
            href="/checkout/credit-bureau"
            className="inline-block px-8 py-3 bg-white text-purple-600 font-semibold rounded-lg hover:bg-gray-100"
          >
            Start Free Trial
          </Link>
        </div>
      </section>

      <section className="py-16 px-4 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold mb-12 text-center">How It Works</h2>
        <div className="space-y-8">
          <div className="flex gap-8">
            <div className="text-4xl font-bold text-purple-600">1</div>
            <div>
              <h3 className="font-bold text-lg mb-2">Mode 1: Off-Chain FICO</h3>
              <p className="text-gray-600">Payment history (40%), volume (30%), age (20%), risk profile (10%)</p>
            </div>
          </div>
          <div className="flex gap-8">
            <div className="text-4xl font-bold text-purple-600">2</div>
            <div>
              <h3 className="font-bold text-lg mb-2">Mode 2: On-Chain Operational</h3>
              <p className="text-gray-600">Success rate (35%), volume (30%), compliance (20%), age (15%)</p>
            </div>
          </div>
          <div className="flex gap-8">
            <div className="text-4xl font-bold text-purple-600">3</div>
            <div>
              <h3 className="font-bold text-lg mb-2">Daily Settlement to Blockchain</h3>
              <p className="text-gray-600">Scores written to ForgeReputationRegistry on Base Sepolia</p>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-gray-50 py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-8">R8.5K / month</h2>
          <p className="text-gray-600 mb-8 text-lg">
            Plus earn 25% of credit inquiry fees from lenders using your agent scores.
          </p>
          <Link
            href="/checkout/credit-bureau"
            className="inline-block px-8 py-3 bg-purple-600 text-white font-semibold rounded-lg hover:bg-purple-700"
          >
            Start Free Trial
          </Link>
        </div>
      </section>
    </div>
  );
}
