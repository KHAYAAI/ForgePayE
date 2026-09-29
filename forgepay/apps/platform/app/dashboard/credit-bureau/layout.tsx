import { requireProduct } from '@/lib/products';

export default async function MerchantCreditBureauLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('credit-bureau');
  return <>{children}</>;
}
