import { requireProduct } from '@/lib/products';

export default async function EnterpriseTreasuryLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('treasury');
  return <>{children}</>;
}
