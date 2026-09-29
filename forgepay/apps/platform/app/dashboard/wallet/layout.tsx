import { requireProduct } from '@/lib/products';

export default async function WalletLayout({ children }: { children: React.ReactNode }) {
  await requireProduct('wallet');
  return <>{children}</>;
}
