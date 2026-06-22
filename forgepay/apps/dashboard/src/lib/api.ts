/**
 * ForgePay dashboard API client.
 * All calls go to the payment-engine (Hyperswitch) via a Next.js API proxy
 * that injects the merchant's API key server-side.
 */

const BASE = '/api';   // Next.js API route proxy

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Payments ──────────────────────────────────────────────────────────────────

export interface Payment {
  payment_id:     string;
  amount:         number;
  currency:       string;
  status:         string;
  payment_method: string;
  customer_id:    string | null;
  created:        string;
  description:    string | null;
}

export interface PaymentListResponse {
  data:  Payment[];
  count: number;
  total: number;
}

export const payments = {
  list:     (params?: Record<string, string>) =>
    request<PaymentListResponse>(`/payments?${new URLSearchParams(params)}`),
  retrieve: (id: string) => request<Payment>(`/payments/${id}`),
  refund:   (id: string, amount?: number) =>
    request<{ refund_id: string }>(`/payments/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
};

// ── Customers ─────────────────────────────────────────────────────────────────

export interface Customer {
  customer_id: string;
  email:       string | null;
  name:        string | null;
  created:     string;
}

export const customers = {
  list:     () => request<{ data: Customer[] }>('/customers'),
  retrieve: (id: string) => request<Customer>(`/customers/${id}`),
};

// ── Subscriptions ─────────────────────────────────────────────────────────────

export interface Subscription {
  subscription_id: string;
  customer_id:     string;
  plan_id:         string;
  status:          string;
  current_period_end: string;
}

export const subscriptions = {
  list: () => request<{ data: Subscription[] }>('/subscriptions'),
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  gross_revenue_cents: number;
  successful_count:    number;
  failed_count:        number;
  success_rate:        number;
  period_start:        string;
  period_end:          string;
}

export const analytics = {
  summary: (days = 30) => request<AnalyticsSummary>(`/analytics/summary?days=${days}`),
};

// ── Enterprise Treasury ───────────────────────────────────────────────────────

export interface TreasuryCashPosition {
  totalUsd:               number;
  idleCashUsd:            number;
  deployedInYieldUsd:     number;
  opportunityCostUsdPerYear: number;
  bySubsidiary:           Record<string, { name: string; totalUsd: number; accountCount: number; runwayDays: number }>;
  byCurrency:             Record<string, { currency: string; balanceUsd: number; fxRate: number }>;
  lastConsolidated:       string;
}

export interface TreasuryRule {
  id:               string;
  name:             string;
  enabled:          boolean;
  condition:        Record<string, unknown>;
  action:           Record<string, unknown>;
  approvalRequired: boolean;
  executionCount:   number;
  lastTriggered?:   string;
}

export interface TreasuryNettingSummary {
  totalGrossUsd:    number;
  totalNetUsd:      number;
  totalFeesSavedUsd: number;
  reductionPercent: number;
  pairsCount:       number;
  flowsCount:       number;
}

export interface TreasuryApproval {
  id:          string;
  rule_id:     string;
  rule_name:   string;
  action:      Record<string, unknown>;
  requestedAt: string;
}

export const treasury = {
  cashPosition:    () => request<{ data: TreasuryCashPosition }>('/treasury/cash-position'),
  listRules:       () => request<{ data: TreasuryRule[]; total: number }>('/treasury/rules'),
  nettingSummary:  () => request<{ data: unknown[]; summary: TreasuryNettingSummary }>('/treasury/netting'),
  pendingApprovals: () => request<{ data: TreasuryApproval[]; total: number }>('/treasury/approvals'),
  agentSummary:    () => request<Record<string, unknown>>('/treasury/summary'),
};

// ── Agent Credit Lines ────────────────────────────────────────────────────────

export interface CreditLineSummary {
  creditLines: { total: number; active: number; suspended: number; closed: number };
  draws:       { total: number; outstanding: number; overdue: number; repaid: number; defaulted: number };
  totals:      { totalIssuedUsd: number; totalOutstandingUsd: number; totalOverdueUsd: number; totalLossUsd: number; defaultRate: number };
  timestamp:   string;
}

export interface CreditLine {
  id:              string;
  agentId:         string;
  limitUsd:        number;
  availableUsd:    number;
  usedUsd:         number;
  termsDays:       number;
  interestRateBps: number;
  status:          string;
  createdAt:       string;
}

export interface CreditDraw {
  id:                   string;
  creditLineId:         string;
  agentId:              string;
  amountUsd:            number;
  totalOwedUsd:         number;
  repaidUsd:            number;
  drawnAt:              string;
  dueAt:                string;
  repaidAt?:            string;
  status:               string;
  purpose:              string;
  counterpartyAgentId?: string;
}

export const creditLines = {
  summary:   () => request<CreditLineSummary>('/credit-lines/summary'),
  listLines: (params?: Record<string, string>) =>
    request<{ data: CreditLine[]; total: number }>(`/credit-lines?${new URLSearchParams(params)}`),
  listDraws: (params?: Record<string, string>) =>
    request<{ data: CreditDraw[]; total: number }>(`/credit-lines/draws?${new URLSearchParams(params)}`),
};
