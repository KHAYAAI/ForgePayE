import { ProductNav } from '@/components/forge/ProductNav';
import { requireProduct } from '@/lib/products';

/* FORGE Custody — standalone product console. */

export default async function CustodyLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('custody');
  return (
    <>
      <ProductNav
        product="FORGE CUSTODY"
        items={[
          { href: '/dashboard/custody', label: 'Overview' },
          { href: '/dashboard/custody/signing', label: 'Signing Queue' },
          { href: '/dashboard/custody/governance', label: 'Governance' },
          { href: '/dashboard/custody/keys', label: 'Keys' },
          { href: '/dashboard/custody/audit', label: 'Audit Log' },
        ]}
      />
      {children}
    </>
  );
}
