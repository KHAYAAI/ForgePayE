export const PRICING_TIERS = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyFee: '$0',
    monthlyFeeLabel: 'per month',
    description: 'Perfect for getting started',
    ctaText: 'Start free',
    badge: null,

    features: [
      'Card payments',
      'Stablecoin & crypto',
      'Up to $25k monthly volume',
      'Basic analytics',
      'Community support',
      'Webhook infrastructure',
    ],

    transaction_fees: {
      card: '2.8% + $0.24',
      stablecoin: '1.8% + gas',
      crypto: '1.8% + gas',
    },

    limits: {
      monthlyVolume: 25000,
      chargeback_threshold: 5,
      team_seats: 1,
      webhooks: true,
      tax_automation: false,
    },

    comparisons: {
      stripe_card: '2.9% + $0.30',
      paddle_card: '5% + $0.50',
    },
  },

  standard: {
    id: 'standard',
    name: 'Standard',
    monthlyFee: '$28',
    monthlyFeeLabel: 'per month, billed annually',
    description: 'For scaling merchants',
    ctaText: 'Get started',
    badge: 'Most popular',

    features: [
      'All Free features',
      'Unlimited monthly volume',
      'Advanced analytics & reporting',
      'Automatic Merchant of Record',
      'Tax calculation in 200+ jurisdictions',
      'Priority support (2h response)',
      'Team members (up to 10)',
      'Custom webhook configuration',
      'Dunning management',
      'Subscription lifecycle',
    ],

    transaction_fees: {
      card: '2.4% + $0.24',
      stablecoin: '1.4% + gas',
      crypto: '1.4% + gas',
    },

    limits: {
      monthlyVolume: null,
      chargeback_threshold: null,
      team_seats: 10,
      webhooks: true,
      tax_automation: true,
    },

    comparisons: {
      stripe_card: '2.9% + $0.30',
      paddle: 'Comparable pricing',
    },
  },
} as const;

export const PRICING = {
  tiers: PRICING_TIERS,

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
