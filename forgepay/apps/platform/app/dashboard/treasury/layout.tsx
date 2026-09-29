import { requireProduct } from '@/lib/products';

export default async function MerchantTreasuryLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('treasury');
  return <>{children}</>;
}
