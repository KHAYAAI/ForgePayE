'use client';

import { useCustomer } from '@/hooks/useCustomer';
import { UpgradePrompt } from './UpgradePrompt';

export interface ProductGateProps {
  product: 'payments' | 'treasury' | 'credit-bureau';
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function ProductGate({ product, children, fallback }: ProductGateProps) {
  const { customer, isLoading } = useCustomer();

  if (isLoading) {
    return <div className="animate-pulse h-64 bg-gray-200 rounded" />;
  }

  const hasProduct = customer?.products?.includes(product);

  if (!hasProduct) {
    return (
      fallback || (
        <UpgradePrompt
          product={product}
          message={`Upgrade to FORGE ${product.charAt(0).toUpperCase() + product.slice(1)} to access this feature.`}
        />
      )
    );
  }

  return <>{children}</>;
}
