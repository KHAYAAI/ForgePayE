'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { PRICING } from '@/lib/pricing';

export default function ROICalculator() {
  const [monthlyVolume, setMonthlyVolume] = useState(500000);
  const [paymentMix, setPaymentMix] = useState({
    cards: 70,
    stablecoin: 20,
    crypto: 10,
  });

  // Calculate ForgePay fees
  const cardVolume = (monthlyVolume * paymentMix.cards) / 100;
  const stablecoinVolume = (monthlyVolume * paymentMix.stablecoin) / 100;
  const cryptoVolume = (monthlyVolume * paymentMix.crypto) / 100;

  // ForgePay fees
  const cardFee = 0.02;
  const cardFixedFee = 0.30;
  const stablecoinFee = 0.014;
  const cryptoFee = 0.014;

  const forgepayCardFees = cardVolume * cardFee + (cardVolume / 100) * cardFixedFee;
  const forgepayStablecoinFees = stablecoinVolume * stablecoinFee;
  const forgepayCardOtherFees = stablecoinVolume * 0.01; // Gas cost estimation
  const forgepayTotalFees = forgepayCardFees + forgepayStablecoinFees + forgepayCardOtherFees + (cryptoVolume * cryptoFee);

  // Stripe comparison
  const stripeCardFee = 0.029;
  const stripeCardFixedFee = 0.30;
  const stripeCardFees = cardVolume * stripeCardFee + (cardVolume / 100) * stripeCardFixedFee;
  const stripeTotalFees = stripeCardFees + (stablecoinVolume + cryptoVolume) * 0;  // Stripe doesn't support stablecoins/crypto

  // Paddle comparison
  const paddleCardFee = 0.05;
  const paddleCardFixedFee = 0.50;
  const paddleCardFees = cardVolume * paddleCardFee + (cardVolume / 100) * paddleCardFixedFee;
  const paddleTotalFees = paddleCardFees + (stablecoinVolume + cryptoVolume) * 0;

  // Savings
  const savingsVsStripe = stripeTotalFees - forgepayTotalFees;
  const savingsVsPaddle = paddleTotalFees - forgepayTotalFees;
  const annualSavingsVsStripe = savingsVsStripe * 12;

  // Tax savings (not charging extra for tax compliance like Paddle)
  const taxCompliance = stablecoinVolume + cryptoVolume > 0 ? (stablecoinVolume + cryptoVolume) * 0.02 : 0;

  // Privacy value (estimated churn reduction)
  const privacyValue = monthlyVolume * 0.02; // 2% conversion uplift from privacy option

  const totalMonthlyBenefit = savingsVsStripe + taxCompliance + privacyValue;

  return (
    <section className="py-24 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-navy-800/40 to-transparent">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <h2 className="text-4xl sm:text-5xl font-black mb-4 tracking-tight">
            Calculate your <span className="text-cyan-500">savings</span>
          </h2>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            See how much you'll save switching from Stripe or Paddle to ForgePay
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Input Controls */}
          <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-8">
            <h3 className="text-xl font-bold text-white mb-8">Your Numbers</h3>

            {/* Monthly Volume Slider */}
            <div className="mb-8">
              <label className="text-sm text-gray-300 mb-3 block">
                Monthly Payment Volume
              </label>
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min="10000"
                  max="10000000"
                  step="50000"
                  value={monthlyVolume}
                  onChange={(e) => setMonthlyVolume(parseInt(e.target.value))}
                  className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-right">
                  <div className="text-2xl font-black text-cyan-400">
                    ${(monthlyVolume / 1000000).toFixed(1)}M
                  </div>
                  <div className="text-xs text-gray-500">/month</div>
                </div>
              </div>
            </div>

            {/* Payment Mix */}
            <div className="space-y-6 mb-8">
              <h4 className="text-sm font-bold text-gray-300 uppercase">Payment Method Mix</h4>

              {[
                { key: 'cards', label: 'Cards (Visa, Amex)', default: 70 },
                { key: 'stablecoin', label: 'Stablecoins (USDC, USDT)', default: 20 },
                { key: 'crypto', label: 'Crypto (BTC, ETH)', default: 10 },
              ].map(({ key, label, default: defaultVal }) => (
                <div key={key}>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-gray-300">{label}</label>
                    <span className="text-sm font-bold text-cyan-400">{paymentMix[key as keyof typeof paymentMix]}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={paymentMix[key as keyof typeof paymentMix]}
                    onChange={(e) =>
                      setPaymentMix({ ...paymentMix, [key]: parseInt(e.target.value) })
                    }
                    className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer"
                  />
                  <div className="text-xs text-gray-500 mt-1">
                    ${((monthlyVolume * paymentMix[key as keyof typeof paymentMix]) / 100).toLocaleString()} /month
                  </div>
                </div>
              ))}

              {/* Validation */}
              {Object.values(paymentMix).reduce((a, b) => a + b, 0) !== 100 && (
                <div className="text-xs text-red-400 mt-2">Payment mix must total 100%</div>
              )}
            </div>

            {/* Monthly Subscription */}
            <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-4 mb-8">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-300">ForgePay Platform Fee</span>
                <span className="font-bold text-cyan-400">{PRICING.monthly}</span>
              </div>
              <div className="text-xs text-gray-500 mt-1">One-time setup (waived first 30 days)</div>
            </div>
          </div>

          {/* Results */}
          <div className="space-y-6">
            {/* ForgePay Summary */}
            <div className="bg-gradient-to-br from-cyan-500/10 to-transparent border border-cyan-500/30 rounded-2xl p-8">
              <h4 className="text-sm font-bold text-cyan-400 uppercase mb-4">ForgePay Costs</h4>
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">Card Processing</span>
                  <span className="text-white font-mono">${forgepayCardFees.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">Stablecoin Processing</span>
                  <span className="text-white font-mono">${(forgepayStablecoinFees + forgepayCardOtherFees).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-300">Crypto Processing</span>
                  <span className="text-white font-mono">${(cryptoVolume * cryptoFee).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
              </div>
              <div className="border-t border-cyan-500/20 pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Total Monthly</span>
                  <span className="text-2xl font-black text-cyan-400">
                    ${forgepayTotalFees.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </div>

            {/* Stripe Comparison */}
            <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-8">
              <h4 className="text-sm font-bold text-gray-400 uppercase mb-4">vs Stripe</h4>
              <div className="space-y-3 mb-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Stripe Monthly Cost</span>
                  <span className="text-white font-mono">${stripeTotalFees.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Tax Compliance</span>
                  <span className="text-gray-500 text-xs">Not included (extra cost)</span>
                </div>
              </div>
              <div className="border-t border-white/10 pt-4">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-white">Your Monthly Savings</span>
                  <span className="text-2xl font-black text-green-400">
                    ${savingsVsStripe.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="text-xs text-green-400 mt-2">
                  = ${annualSavingsVsStripe.toLocaleString('en-US', { maximumFractionDigits: 2 })} per year
                </div>
              </div>
            </div>

            {/* Hidden Value */}
            {(taxCompliance + privacyValue > 0) && (
              <div className="bg-white/[0.02] border border-white/10 rounded-2xl p-8">
                <h4 className="text-sm font-bold text-gray-400 uppercase mb-4">Bonus Benefits</h4>
                <div className="space-y-3">
                  {taxCompliance > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-300">Tax Compliance (included)</span>
                      <span className="text-green-400 font-mono">+${taxCompliance.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                  {privacyValue > 0 && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-300">Privacy Uplift (2% conversion)</span>
                      <span className="text-green-400 font-mono">+${privacyValue.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                    </div>
                  )}
                </div>
                <div className="border-t border-white/10 pt-4 mt-4">
                  <div className="text-sm">
                    <span className="text-gray-400">Estimated Total Monthly Benefit</span>
                    <div className="text-2xl font-black text-green-400 mt-2">
                      ${totalMonthlyBenefit.toLocaleString('en-US', { maximumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center mt-12">
          <p className="text-gray-400 mb-4">Ready to see these savings in action?</p>
          <a
            href="/signup"
            className="inline-block bg-cyan-500 hover:bg-cyan-400 text-navy-800 font-bold px-8 py-4 rounded-xl transition-all duration-200 glow-cyan hover:scale-105"
          >
            Start Free Trial Today
          </a>
          <p className="text-xs text-gray-500 mt-4">No credit card required. $5/mo waived for first 30 days.</p>
        </div>
      </div>
    </section>
  );
}
