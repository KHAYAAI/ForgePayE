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

export const ALL_SKILLS: SkillDefinition[] = [
  PAYMENTS_SKILL,
  ANALYTICS_SKILL,
  TREASURY_SKILL,
];

export const SKILLS_BY_ID = new Map<string, SkillDefinition>(
  ALL_SKILLS.map(s => [s.id, s])
);
