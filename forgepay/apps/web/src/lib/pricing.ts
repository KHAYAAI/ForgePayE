export const PRICING = {
  monthly: '$5',
  monthlyNote: 'per month',

  card: {
    fee: '2% + $0.20',
    label: 'Card fee',
    stripeComparison: '2.9% + $0.30',
    paddleComparison: '5% + $0.50',
  },

  stablecoin: {
    fee: '1.4% + gas',
    label: 'Stablecoin fee',
  },

  crypto: {
    fee: '1.4% + gas',
    label: 'Crypto fee',
  },
} as const;
