'use client';

import useSWR from 'swr';
import type { Product, ProductKey } from '@/lib/products';

/**
 * The signed-in merchant and the platforms they hold.
 *
 * This hook is what `ProductGate` and the sidebar were written against — it
 * was imported by five components and never existed, which is one of the four
 * unresolved imports that kept this app from building.
 *
 * Treat `hasProduct` as a presentation helper only. It decides what to render;
 * it does not decide what is allowed. Server-side, every product route calls
 * `requireProduct()` (lib/entitlements.ts), because hiding a nav item does not
 * stop anyone calling the API behind it.
 */

export interface Entitlement {
  product_key: ProductKey;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled';
  plan: string | null;
  trial_ends_at: string | null;
}

export interface Customer {
  id: string;
  email: string;
  name: string | null;
  products: ProductKey[];
  entitlements: Entitlement[];
}

interface CustomerResponse {
  customer: Customer;
  catalog: Product[];
}

const fetcher = async (url: string): Promise<CustomerResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`customer request failed: ${res.status}`);
  return res.json();
};

export function useCustomer() {
  const { data, error, isLoading, mutate } = useSWR<CustomerResponse>('/api/customer', fetcher, {
    // Entitlements change when someone adds a product, which is rare and
    // always initiated here — so revalidating on every window focus is noise.
    revalidateOnFocus: false,
  });

  const products = data?.customer.products ?? [];

  return {
    customer:    data?.customer,
    catalog:     data?.catalog ?? [],
    entitlements: data?.customer.entitlements ?? [],
    isLoading,
    error,
    /** Presentation only — see the note above. */
    hasProduct: (key: ProductKey) => products.includes(key),
    /** Re-read after adding or removing a product. Named to match the
     *  onboarding pages that were written against this hook. */
    refetch: mutate,
  };
}
