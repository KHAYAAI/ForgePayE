import type { SkillDefinition } from "./types";

export const PAYMENTS_SKILL: SkillDefinition = {
  id:          "payments",
  name:        "Payments Expert",
  description: "Deep expertise on ForgePay payment operations and fee structures",
  instructions: `When analyzing payments:
- Distinguish fee structures: card (2.4-2.8% + $0.24), stablecoin (1.4%), crypto (1.4% + gas)
- Flag if refund rate exceeds 2% of monthly volume (chargeback risk signal)
- For failed payments, differentiate: insufficient_funds vs card_declined vs fraud
- "Net revenue" = gross volume minus ForgePay fees
- USDC/USDT settle in 30 seconds; ETH needs 3 confirmations (~15 min); BTC ~30 min
- When showing payment counts, always include success rate percentage`,
  toolsets: ["payments", "analytics", "crypto"],
  modes:    ["insight", "act"],
};

export const ANALYTICS_SKILL: SkillDefinition = {
  id:          "analytics",
  name:        "Analytics Advisor",
  description: "Revenue intelligence, MRR tracking, and cohort analysis",
  instructions: `When producing analytics:
- Always state the date range being analyzed
- MRR = sum of all active subscription monthly recurring charges
- Churn rate = (subscriptions cancelled this month) / (subscriptions at month start)
- For period comparisons, normalize for number of business days
- Show amounts as $X,XXX.XX for values over $1,000
- LTV estimate = (average monthly revenue per customer) / churn rate
- When asked about "growth", show both absolute and percentage change`,
  toolsets: ["analytics", "customers", "subscriptions"],
  modes:    ["insight", "act"],
};

export const TREASURY_SKILL: SkillDefinition = {
  id:          "treasury",
  name:        "Treasury Manager",
  description: "Yield optimization and idle balance management",
  instructions: `Treasury context:
- Idle USDC/USDT balances can earn yield via Aave V3 (~4.5-5.5% APY), Compound V3 (~3.8-4.8%), or Ondo USDY (~5.0%)
- Auto-sweep moves idle balances above a threshold into the best-APY vault
- Aave/Compound withdrawals are instant; Ondo USDY has a 24h redemption delay
- Always recommend keeping a reserve for incoming refunds/chargebacks
- For merchants with >$10,000 idle USDC, recommend enabling auto-sweep
- Realized yield is taxable income; unrealized yield is not
- Report yield as annualized APY and also as projected monthly earnings`,
  toolsets: ["analytics"],
  modes:    ["insight", "act"],
};

export const AGENTIC_COMMERCE_SKILL: SkillDefinition = {
  id: "agentic_commerce",
  name: "Agentic Commerce Specialist",
  description: "Expert in AI agent negotiations, escrow management, and agentic transactions",
  instructions: `Agentic commerce context:
- AI agents self-register with capabilities: negotiation, escrow, payment, logistics, delivery
- Reputation scores range 0-100; agents with >50 are considered reliable
- Negotiation sessions have status: negotiating → agreed → escrow_funded → completed (or disputed)
- USDC escrow locks on Base chain; 3-day dispute window after agreement
- When starting a negotiation, always confirm both agent IDs exist via discover_agents first
- A session is "stuck" if status=negotiating for >30 minutes with no new messages
- Escrow disputes require both parties to agree or escalate to human arbitration
- Agentic payments via x402 protocol: merchant exposes HTTP 402, agent pays automatically
- Always check reputation before recommending an agent to the merchant
- For goods/services >$10,000 recommend requiring additional attestations before escrow`,
  toolsets: ["agents", "analytics"],
  modes: ["act"],
};

export const RWA_SPECIALIST_SKILL: SkillDefinition = {
  id: "rwa_specialist",
  name: "RWA Investment Specialist",
  description: "Expert in tokenized real-world assets, yield optimization, and income tax reporting",
  instructions: `RWA (Real-World Asset) context:
- Available assets: Ondo USDY (5.0-5.3% APY), OpenEden TBILL (5.2-5.4%), Franklin FOBXX (4.8-5.1%), BlackRock BUIDL (money market), Superstate USTB (5.18%)
- Always check APY vs risk profile: T-bills are lowest risk; corporate bond funds are higher
- Redemption delays: USDY T+2 days, FOBXX T+3 days, BUIDL instant, TBILL T+5 days
- Minimum investments: most require $1,000-$5,000 minimum
- Income types: interest income (ordinary tax rate ~24-37%), qualified dividends (15-20%), capital gains
- Before recommending redemption, warn about tax implications (realized gains)
- For merchants earning >$50k/year in RWA income, recommend consulting a tax advisor
- NAV (Net Asset Value) updates every 6 hours; prices shown may be slightly stale
- When computing yield, use: yield_usd = principal × (apy/100) × (days_held/365)
- Keep 20-30% of idle balance liquid (not in RWA) for operational needs`,
  toolsets: ["rwa", "analytics"],
  modes: ["insight", "act"],
};

export const BILLING_SPECIALIST_SKILL: SkillDefinition = {
  id: "billing_specialist",
  name: "Billing & Invoicing Expert",
  description: "Expert in subscription management, dunning, and invoice operations",
  instructions: `Billing context:
- Subscriptions have dunning: retry on days 1, 3, 5, 7 after initial failure
- Past-due subscriptions enter "suspended" status after all retries exhausted
- Proration: upgrade mid-period = credit for remaining days + charge for new plan
- Invoice credits reduce the next invoice amount (not a refund to payment method)
- Apply credit proactively to past_due customers to prevent churn
- Churn alert: customers 3+ months past_due are likely permanently churned
- LTV = (avg monthly plan revenue × 12) × (1 / annual_churn_rate)
- Annual plans have lower churn (committed) but higher refund risk (prorated)
- Refunds for subscriptions: within 7 days = full; 8-30 days = prorated; >30 days = no refund (policy)
- Invoice payment links expire after 48 hours; resend before following up with customer
- When listing overdue accounts, sort by amount owed descending (highest risk first)`,
  toolsets: ["analytics", "customers", "subscriptions"],
  modes: ["insight", "act"],
};

export const INTEGRATION_SPECIALIST_SKILL: SkillDefinition = {
  id: "integration_specialist",
  name: "Integration & SDK Expert",
  description: "Expert in ForgePay SDK, webhooks, and payment integration patterns",
  instructions: `Integration context:
- ForgePay supports: JS/TS (@forgepay/sdk), Python (forgepay), REST API directly
- Card payments: 2.2% + $0.20 per transaction (Standard tier)
- Stablecoin: 1.4% + gas (Base chain: ~$0.10 per tx)
- Crypto: 1.4% + network fee (BTC ~$2, ETH ~$0.50 on L2)
- Webhook events: payment.succeeded, payment.failed, subscription.renewed, subscription.past_due, invoice.paid
- Always verify webhook signatures: HMAC-SHA256 of raw body with webhook secret
- Idempotency: use idempotency_key to prevent duplicate charges
- Test mode: use sk_test_ prefix; live mode: sk_live_ prefix
- For subscriptions, always set success_url and cancel_url on checkout
- x402 protocol for AI agents: return 402 with payment details, agent pays autonomously
- SDK code should use try/catch around all payment calls
- When showing code, include error handling and idempotency_key pattern`,
  toolsets: ["integration", "analytics"],
  modes: ["integrate", "insight"],
};

export const COMPLIANCE_SKILL: SkillDefinition = {
  id: "compliance",
  name: "Compliance & Risk Advisor",
  description: "Expert in AML, OFAC screening, tax compliance, and payment risk",
  instructions: `Compliance context:
- OFAC screening: run compliance_check before confirming any transaction >$5,000
- AML red flags: structuring (multiple txns just below $10k), velocity spikes, dormant accounts
- KYC required for: stablecoin custody accounts, enterprise treasury, agent escrow >$10k
- SAR (Suspicious Activity Report) threshold: risk_score >50 from compliance_check
- Tax compliance: MoR handles VAT/GST automatically for Standard tier merchants
- For B2B EU transactions: request VAT ID from customer (enables reverse charge, 0% VAT)
- Crypto transactions are taxable events: buying, selling, trading, and using crypto to pay
- US merchants: 1099-K threshold is $600 (as of 2024); report to customers
- PCI DSS: never log card numbers, CVV, or full PAN in application logs
- For suspicious patterns, always run compliance_check before recommending actions
- Sanctions screening: check both sender AND receiver for every transaction`,
  toolsets: ["analytics", "payments"],
  modes: ["insight", "act"],
};

export const ALL_SKILLS: SkillDefinition[] = [
  PAYMENTS_SKILL,
  ANALYTICS_SKILL,
  TREASURY_SKILL,
  AGENTIC_COMMERCE_SKILL,
  RWA_SPECIALIST_SKILL,
  BILLING_SPECIALIST_SKILL,
  INTEGRATION_SPECIALIST_SKILL,
  COMPLIANCE_SKILL,
];

export const SKILLS_BY_ID = new Map<string, SkillDefinition>(
  ALL_SKILLS.map(s => [s.id, s])
);
