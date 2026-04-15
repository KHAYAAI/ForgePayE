# ForgePay Merchant Dashboard

Next.js 14 frontend — forked from the Polar merchant portal, re-skinned with ForgePay brand.

## Features

- **Onboarding**: merchant sign-up, KYC/KYB, API key generation
- **Payments**: real-time payment ledger, search, filters, refund initiation
- **Billing**: subscription management, plan creation, usage graphs
- **Analytics**: revenue, conversion, churn, MRR/ARR (Recharts)
- **Tax**: MoR dashboard — VAT/GST collected per country, filing status
- **Webhooks**: endpoint registration, delivery log, replay
- **Settings**: team, API keys, billing info, payout accounts

## Tech Stack

- Next.js 14 App Router + TypeScript
- Tailwind CSS (ForgePay design tokens)
- ForgePay JS SDK for API calls
- Clerk for auth (or self-hosted Auth.js)
- Recharts for data visualization

## Development

```bash
cd forgepay/apps/dashboard
npm install
npm run dev     # port 3001
```

## Brand Tokens

```css
--color-navy: #0A2540;
--color-cyan:  #00F0FF;
```
