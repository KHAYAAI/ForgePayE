'use client';

import { useState, useMemo } from 'react';
import { PRICING_TIERS } from '@/lib/pricing';

interface PricingCalculatorProps {
  currentMonthlyVolume?: number;
  chargebackCount?: number;
  teamSize?: number;
}

export default function PricingCalculator({
  currentMonthlyVolume = 5000,
  chargebackCount = 0,
  teamSize = 1,
}: PricingCalculatorProps) {
  const [monthlyVolume, setMonthlyVolume] = useState(currentMonthlyVolume);

  const calculations = useMemo(() => {
    // Assume 80% cards, 20% stablecoin/crypto mix
    const cardVolume = monthlyVolume * 0.8;
    const cryptoVolume = monthlyVolume * 0.2;

    // Free tier costs
    const freePlatformFee = 0;
    const freeCardFee = cardVolume * 0.028 + cardVolume * (0.24 / 100); // 2.8% + $0.24 per transaction avg
    const freeCryptoFee = cryptoVolume * 0.018; // 1.8%
    const freeTotal = freePlatformFee + freeCardFee + freeCryptoFee;

    // Standard tier costs
    const standardPlatformFee = 28;
    const standardCardFee = cardVolume * 0.024 + cardVolume * (0.24 / 100); // 2.4% + $0.24
    const standardCryptoFee = cryptoVolume * 0.014; // 1.4%
    const standardTotal = standardPlatformFee + standardCardFee + standardCryptoFee;

    // Calculate savings
    const monthlySavings = freeTotal - standardTotal;
    const annualSavings = monthlySavings * 12;

    // Check upgrade triggers
    const upgradeTriggers = [];
    if (monthlyVolume > 25000) {
      upgradeTriggers.push({
        type: 'volume',
        title: 'Volume Cap Exceeded',
        message: `Your ${monthlyVolume.toLocaleString()} monthly volume exceeds the Free tier limit of $25,000. Upgrade to Standard for unlimited volume.`,
        severity: 'critical',
      });
    }
    if (chargebackCount >= 5) {
      upgradeTriggers.push({
        type: 'chargeback',
        title: 'Chargeback Threshold Exceeded',
        message: `${chargebackCount} chargebacks detected. Standard tier includes dunning & chargeback management to protect your revenue.`,
        severity: 'critical',
      });
    }
    if (teamSize > 1) {
      upgradeTriggers.push({
        type: 'team',
        title: 'Team Size Exceeded',
        message: `Your team of ${teamSize} members exceeds the Free tier limit of 1. Upgrade to Standard for up to 10 team members.`,
        severity: 'warning',
      });
    }

    return {
      free: {
        platformFee: freePlatformFee,
        transactionFees: freeCardFee + freeCryptoFee,
        total: freeTotal,
      },
      standard: {
        platformFee: standardPlatformFee,
        transactionFees: standardCardFee + standardCryptoFee,
        total: standardTotal,
      },
      comparison: {
        monthlySavings,
        annualSavings,
      },
      upgradeTriggers,
    };
  }, [monthlyVolume, chargebackCount, teamSize]);

  const isFreeViable = monthlyVolume <= 25000 && chargebackCount < 5 && teamSize === 1;

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Volume Input */}
      <div className="bg-navy-800/30 border border-white/10 rounded-xl p-6">
        <label className="block text-sm font-semibold text-white mb-3">
          Estimated Monthly Transaction Volume
        </label>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="0"
            max="100000"
            step="1000"
            value={monthlyVolume}
            onChange={(e) => setMonthlyVolume(Number(e.target.value))}
            className="flex-1 h-2 bg-white/10 rounded-full appearance-none cursor-pointer"
          />
          <div className="text-right">
            <div className="text-2xl font-black text-cyan-400">
              ${monthlyVolume.toLocaleString()}
            </div>
            <div className="text-xs text-gray-400">per month</div>
          </div>
        </div>
      </div>

      {/* Upgrade Triggers */}
      {calculations.upgradeTriggers.length > 0 && (
        <div className="space-y-3">
          {calculations.upgradeTriggers.map((trigger) => (
            <div
              key={trigger.type}
              className={`p-4 rounded-xl border-l-4 ${
                trigger.severity === 'critical'
                  ? 'border-l-red-500 bg-red-500/10 border border-red-500/20'
                  : 'border-l-yellow-500 bg-yellow-500/10 border border-yellow-500/20'
              }`}
            >
              <h4 className="font-semibold text-white mb-1">{trigger.title}</h4>
              <p className="text-sm text-gray-300">{trigger.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pricing Comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Free Tier Card */}
        <div
          className={`rounded-xl border p-6 transition-opacity ${
            isFreeViable
              ? 'border-white/20 bg-navy-800/30'
              : 'border-red-500/20 bg-red-500/5 opacity-60'
          }`}
        >
          <div className="mb-6">
            <h3 className="text-lg font-bold text-white mb-1">Free Tier</h3>
            <p className="text-sm text-gray-400">
              {isFreeViable
                ? 'You can use the Free tier'
                : 'You must upgrade to Standard'}
            </p>
          </div>

          <div className="space-y-4 mb-8 pb-8 border-b border-white/10">
            <div>
              <div className="text-sm text-gray-400 mb-1">Platform Fee</div>
              <div className="text-2xl font-black text-white">$0</div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">
                Transaction Fees (estimated)
              </div>
              <div className="text-2xl font-black text-cyan-400">
                ${calculations.free.transactionFees.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Based on 80% cards, 20% crypto
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-400 mb-2">Total Monthly Cost</div>
            <div className="text-3xl font-black text-white">
              ${calculations.free.total.toFixed(2)}
            </div>
          </div>
        </div>

        {/* Standard Tier Card */}
        <div className="rounded-xl border-2 border-cyan-500/60 bg-navy-700/40 glow-cyan p-6">
          <div className="mb-6">
            <div className="inline-block bg-cyan-500 text-navy-800 text-xs font-black px-2 py-1 rounded mb-2">
              MOST POPULAR
            </div>
            <h3 className="text-lg font-bold text-white mb-1">Standard Tier</h3>
            <p className="text-sm text-gray-300">Recommended for scaling</p>
          </div>

          <div className="space-y-4 mb-8 pb-8 border-b border-cyan-500/20">
            <div>
              <div className="text-sm text-gray-400 mb-1">Platform Fee</div>
              <div className="text-2xl font-black text-white">
                $28
                <span className="text-sm font-normal text-gray-400 ml-2">
                  /month
                </span>
              </div>
            </div>
            <div>
              <div className="text-sm text-gray-400 mb-1">
                Transaction Fees (estimated)
              </div>
              <div className="text-2xl font-black text-cyan-400">
                ${calculations.standard.transactionFees.toFixed(2)}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Based on 80% cards, 20% crypto
              </div>
            </div>
          </div>

          <div>
            <div className="text-sm text-gray-400 mb-2">Total Monthly Cost</div>
            <div className="text-3xl font-black text-cyan-400">
              ${calculations.standard.total.toFixed(2)}
            </div>
          </div>
        </div>
      </div>

      {/* Savings Insight */}
      {!isFreeViable || monthlyVolume > 10000 ? (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-6">
          <h4 className="font-bold text-green-400 mb-2">💰 Smart Choice</h4>
          {calculations.comparison.monthlySavings > 0 ? (
            <p className="text-white">
              By upgrading to Standard, you'll save{' '}
              <span className="font-black text-green-400">
                ${calculations.comparison.monthlySavings.toFixed(2)}/month
              </span>{' '}
              (
              <span className="font-black text-green-400">
                ${calculations.comparison.annualSavings.toFixed(0)}/year
              </span>
              ) on transaction fees. Plus, you'll get:
            </p>
          ) : (
            <p className="text-white">
              For your volume level, Standard is the same or cheaper. Plus, you'll unlock:
            </p>
          )}
          <ul className="mt-3 space-y-1 text-sm text-gray-300">
            <li>✓ Merchant of Record (tax in 200+ countries)</li>
            <li>✓ Unlimited transaction volume</li>
            <li>✓ Dunning & chargeback management</li>
            <li>✓ Advanced analytics & LTV tracking</li>
            <li>✓ Priority support (2-hour response)</li>
          </ul>
        </div>
      ) : (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-6">
          <h4 className="font-bold text-blue-400 mb-2">📈 Growing?</h4>
          <p className="text-white text-sm">
            Once you reach $25,000/month, you'll automatically upgrade to Standard. Get ahead with
            unlimited volume and tax compliance today.
          </p>
        </div>
      )}

      {/* Fine Print */}
      <div className="text-xs text-gray-500 space-y-2">
        <p>* Gas fees for blockchain transactions paid to the network, not ForgePay</p>
        <p>* Estimates assume average $100 transaction value. Your actual fees depend on transaction sizes.</p>
        <p>
          * Stablecoin and crypto fees assume successful transactions. Failed transactions incur no fee.
        </p>
      </div>
    </div>
  );
}
