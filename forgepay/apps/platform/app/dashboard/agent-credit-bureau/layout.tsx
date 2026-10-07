import { ProductNav } from '@/components/forge/ProductNav';
import { requireProduct } from '@/lib/products';

/* FORGE Agent Credit Bureau — standalone product console. */

export default async function BureauLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('credit-bureau');
  return (
    <>
      <ProductNav
        product="AGENT CREDIT BUREAU"
        items={[
          { href: '/dashboard/agent-credit-bureau', label: 'Overview' },
          { href: '/dashboard/agent-credit-bureau/agents', label: 'Agents' },
          { href: '/dashboard/agent-credit-bureau/connect-wallet', label: 'Connect wallet' },
          { href: '/dashboard/agent-credit-bureau/scores', label: 'Scores' },
          { href: '/dashboard/agent-credit-bureau/verify', label: 'Verify' },
          { href: '/dashboard/agent-credit-bureau/disputes', label: 'Disputes' },
          { href: '/dashboard/agent-credit-bureau/consent', label: 'Consent' },
          { href: '/dashboard/agent-credit-bureau/institution', label: 'Institution' },
          { href: '/dashboard/agent-credit-bureau/developers', label: 'Developers' },
        ]}
      />
      {children}
    </>
  );
}
