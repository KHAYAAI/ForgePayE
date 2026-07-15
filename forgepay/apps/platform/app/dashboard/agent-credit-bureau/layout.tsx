import { ProductNav } from '@/components/forge/ProductNav';

/* FORGE Agent Credit Bureau — standalone product console. */

export default function BureauLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ProductNav
        product="AGENT CREDIT BUREAU"
        items={[
          { href: '/dashboard/agent-credit-bureau', label: 'Overview' },
          { href: '/dashboard/agent-credit-bureau/agents', label: 'Agents' },
          { href: '/dashboard/agent-credit-bureau/scores', label: 'Scores' },
          { href: '/dashboard/agent-credit-bureau/verify', label: 'Verify' },
          { href: '/dashboard/agent-credit-bureau/disputes', label: 'Disputes' },
          { href: '/dashboard/agent-credit-bureau/developers', label: 'Developers' },
        ]}
      />
      {children}
    </>
  );
}
