# @forgepay/sdk

Official JavaScript / TypeScript SDK for the ForgePay API.

## Installation

```bash
npm install @forgepay/sdk
# or
pnpm add @forgepay/sdk
```

## Quick Start

```typescript
import { ForgePay } from '@forgepay/sdk';

const forgepay = new ForgePay({ apiKey: 'fpk_live_...' });

// Create a payment
const payment = await forgepay.payments.create({
  amount: 2000,         // in cents
  currency: 'USD',
  paymentMethod: 'card',
  customerId: 'cus_123',
  idempotencyKey: 'order_xyz_001',
});

// Create a subscription
const subscription = await forgepay.subscriptions.create({
  customerId: 'cus_123',
  planId: 'plan_pro_monthly',
  trialDays: 14,
});

// Accept stablecoin (USDC on Base)
const stablecoinPayment = await forgepay.stablecoins.create({
  amount: '99.00',
  currency: 'USDC',
  chain: 'base',
  customerId: 'cus_123',
});
```

## Design Principles

- **Type-safe**: Full TypeScript types generated from OpenAPI spec
- **Idempotent**: All create operations accept `idempotencyKey`
- **Retry-safe**: Automatic retries with exponential backoff on 5xx
- **Tree-shakeable**: Import only what you need
