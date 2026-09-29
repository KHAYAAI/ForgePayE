import { ProductNav } from '@/components/forge/ProductNav';
import { requireProduct } from '@/lib/products';

/* FORGE Payments — standalone product console. */

export default async function PaymentsLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('payments');
  return (
    <>
      <ProductNav
        product="FORGE PAYMENTS"
        items={[
          { href: '/dashboard/payments', label: 'Overview' },
          { href: '/dashboard/payments/transactions', label: 'Transactions' },
          { href: '/dashboard/payments/routing', label: 'Routing' },
          { href: '/dashboard/payments/disputes', label: 'Disputes' },
          { href: '/dashboard/payments/developers', label: 'Developers' },
        ]}
      />
      {children}
    </>
  );
}
