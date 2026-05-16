/**
 * ForgePay Agent Credit Lines — Type Definitions
 *
 * Domain model for issuing revolving credit lines to AI agents with net
 * payment terms (30/60/90 days), interest accrual, and default tracking.
 */

export type CreditTerms = 30 | 60 | 90;

export type CreditLineStatus = 'active' | 'suspended' | 'closed';

export interface CreditLine {
  id: string;
  agentId: string;
  limitUsd: number;
  availableUsd: number;
  usedUsd: number;
  termsDays: CreditTerms;
  interestRateBps: number;        // Basis points, e.g. 600 = 6.00% APR
  status: CreditLineStatus;
  createdAt: string;              // ISO timestamp
}

export type DrawStatus = 'outstanding' | 'repaid' | 'overdue' | 'defaulted';

export interface CreditDraw {
  id: string;
  creditLineId: string;
  agentId: string;
  amountUsd: number;              // Principal drawn
  totalOwedUsd: number;           // Principal + interest at drawnAt
  repaidUsd: number;              // Cumulative repayments
  drawnAt: string;                // ISO timestamp
  dueAt: string;                  // ISO timestamp
  repaidAt?: string;              // ISO timestamp when fully repaid
  status: DrawStatus;
  purpose: string;
  counterpartyAgentId?: string;
}

export interface CreditAssessment {
  agentId: string;
  approved: boolean;
  recommendedLimitUsd: number;
  recommendedTermsDays: CreditTerms;
  recommendedInterestRateBps: number;
  reasons: string[];
  reputationScore?: number;
  transactionCount?: number;
}

export interface DefaultRecord {
  drawId: string;
  agentId: string;
  defaultedAt: string;            // ISO timestamp
  recoveredAmountUsd: number;
  lossUsd: number;
}
