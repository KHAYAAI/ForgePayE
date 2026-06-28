'use client';

const PRODUCT_INFO: Record<string, { name: string; price: string; url: string; description: string }> = {
  payments: {
    name: 'FORGE Payments',
    price: 'R15K/mo',
    url: '/checkout/payments?tier=growth',
    description: 'Simple payment processing with 40% lower fees than Stripe',
  },
  treasury: {
    name: 'FORGE Treasury',
    price: 'R40K/mo',
    url: '/checkout/treasury',
    description: 'Automate cash netting and multi-currency settlements',
  },
  'credit-bureau': {
    name: 'FORGE Credit Bureau',
    price: 'R8.5K/mo',
    url: '/checkout/credit-bureau',
    description: 'Real-time agent credit scoring and on-chain settlement',
  },
};

export interface UpgradePromptProps {
  product: 'payments' | 'treasury' | 'credit-bureau';
  message?: string;
}

export function UpgradePrompt({ product, message }: UpgradePromptProps) {
  const info = PRODUCT_INFO[product];

  return (
    <div className="flex flex-col items-center justify-center p-12 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200">
      <h2 className="text-2xl font-bold text-gray-900 mb-2">{info.name}</h2>
      <p className="text-gray-600 mb-4 max-w-md text-center">
        {message || info.description}
      </p>
      <p className="text-lg font-semibold text-indigo-600 mb-6">{info.price}</p>
      <a
        href={info.url}
        className="px-6 py-3 bg-indigo-600 text-white font-semibold rounded-lg hover:bg-indigo-700 transition"
      >
        Upgrade Now
      </a>
      <p className="text-sm text-gray-500 mt-4">14-day free trial included</p>
    </div>
  );
}
