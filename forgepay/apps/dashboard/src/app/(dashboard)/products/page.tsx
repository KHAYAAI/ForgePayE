'use client';

import { useState } from 'react';
import { Loader2, Check, Lock, Clock, ArrowRight } from 'lucide-react';
import { useCustomer } from '@/hooks/useCustomer';
import { PRODUCTS, type ProductKey } from '@/lib/products';
import { PRICING, formatUsdCents } from '@/lib/pricing';

/**
 * Platform selection — the entry point to everything else.
 *
 * ForgePay is several platforms a merchant chooses among rather than one
 * product, so this screen is where they say which ones they want. Each is
 * independently activatable: the bureau without payments, treasury without
 * either.
 *
 * Availability is shown honestly. A platform gated on a licence we do not hold
 * says so and cannot be self-activated; one whose service is still being
 * hardened offers a trial rather than pretending to be generally available.
 */
export default function ProductsPage() {
  const { customer, isLoading, hasProduct, refetch } = useCustomer();
  const [busy, setBusy]   = useState<ProductKey | null>(null);
  const [error, setError] = useState('');

  async function toggle(product: ProductKey, active: boolean) {
    setBusy(product);
    setError('');
    try {
      const res = await fetch('/api/customer/products', {
        method:  active ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ product }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message ?? data?.error ?? 'Request failed');
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-6">
        <Loader2 size={15} className="animate-spin" /> Loading your platforms…
      </div>
    );
  }

  const activeCount = customer?.products.length ?? 0;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl font-bold text-white">Platforms</h1>
        <p className="text-sm text-gray-400">
          Choose what you want to run. Each platform works on its own, and they share one
          account, one login, and one bill.
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-500/10 border border-red-500/30 text-red-400 text-sm rounded-lg px-4 py-2.5">
          {error}
        </div>
      )}

      {activeCount === 0 && (
        <div className="bg-cyan-500/[0.07] border border-cyan-500/25 rounded-lg px-4 py-3 text-sm text-cyan-200">
          You have not activated a platform yet. Start with one — you can add the others at any time.
        </div>
      )}

      <div className="grid gap-3">
        {PRODUCTS.map((product) => {
          const active    = hasProduct(product.key);
          const pricing   = PRICING[product.key];
          const isPrivate = product.availability === 'private';
          const waitlist  = product.availability === 'waitlist';
          const working   = busy === product.key;

          return (
            <div
              key={product.key}
              className={`card p-5 border transition-colors ${
                active ? 'border-cyan-500/40' : 'border-white/10'
              }`}
            >
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0 space-y-2.5">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h3 className="text-sm font-semibold text-white">{product.name}</h3>
                    {active && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-cyan-500/15 text-cyan-300 px-1.5 py-0.5 rounded">
                        <Check size={10} /> Active
                      </span>
                    )}
                    {isPrivate && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-white/5 text-gray-400 px-1.5 py-0.5 rounded">
                        <Lock size={10} /> Licence pending
                      </span>
                    )}
                    {waitlist && !active && (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded">
                        <Clock size={10} /> Early access
                      </span>
                    )}
                  </div>

                  <p className="text-xs text-gray-400">{product.tagline}</p>

                  <ul className="space-y-1">
                    {product.highlights.map((h) => (
                      <li key={h} className="flex gap-2 text-xs text-gray-500">
                        <span className="text-cyan-500/60 shrink-0">▸</span>{h}
                      </li>
                    ))}
                  </ul>

                  <div className="text-xs text-gray-500 pt-0.5">
                    {pricing.pending ? (
                      <span className="text-gray-600">Pricing not announced yet</span>
                    ) : (
                      <span>
                        {pricing.tiers[0]?.monthlyUsdCents
                          ? `From ${formatUsdCents(pricing.tiers[0].monthlyUsdCents)}/month · `
                          : ''}
                        {pricing.tiers[0]?.lines[0]
                          ? `${pricing.tiers[0].lines[0].label} ${
                              pricing.tiers[0].lines[0].rate
                                ? `${(pricing.tiers[0].lines[0].rate * 100).toFixed(1)}%`
                                : formatUsdCents(pricing.tiers[0].lines[0].amountUsdCents)
                            }`
                          : ''}
                      </span>
                    )}
                  </div>
                </div>

                <div className="shrink-0">
                  {isPrivate ? (
                    <button
                      disabled
                      className="text-xs px-3.5 py-2 rounded-lg border border-white/10 text-gray-600 cursor-not-allowed"
                      title="Awaiting the payments licence"
                    >
                      Unavailable
                    </button>
                  ) : (
                    <button
                      onClick={() => toggle(product.key, active)}
                      disabled={working}
                      className={`text-xs font-semibold px-3.5 py-2 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-50 ${
                        active
                          ? 'border border-white/10 text-gray-400 hover:text-gray-200'
                          : 'bg-cyan-500 hover:bg-cyan-400 text-navy-800'
                      }`}
                    >
                      {working && <Loader2 size={12} className="animate-spin" />}
                      {active ? 'Deactivate' : waitlist ? 'Start trial' : 'Activate'}
                      {!active && !working && <ArrowRight size={12} />}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs text-gray-600">
        Deactivating a platform stops billing for it and hides it from your dashboard. Your data is
        retained, so reactivating restores it.
      </p>
    </div>
  );
}
