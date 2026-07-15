import { ProductNav } from '@/components/forge/ProductNav';

/* FORGE Custody — standalone product console. */

export default function CustodyLayout({ children }: { children: React.ReactNode }) {
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
