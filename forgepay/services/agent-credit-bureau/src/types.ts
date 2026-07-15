/**
 * ForgePay Agent Credit Bureau — Type Definitions
 * ────────────────────────────────────────────────
 * All domain types for the world's first credit bureau for autonomous AI agents.
 */

export type CreditTier =
  | 'DEEP_SUBPRIME'
  | 'SUBPRIME'
  | 'NEAR_PRIME'
  | 'PRIME'
  | 'SUPER_PRIME';

export interface AgentCreditProfile {
  agentId: string;
  did: string;
  operatorEntityId: string;         // Legal entity (EIN/VAT/TRN) bound to this agent
  operatorEntityType: 'individual' | 'llc' | 'corp' | 'dao';
  currentScore: number;             // 0–1000
  tier: CreditTier;
  scoreFactors: ScoreFactor[];      // Top 4 reasons for score
  creditHistory: CreditEvent[];
  totalDebt: number;                // USD
  totalCreditLimit: number;         // USD
  utilizationRate: number;          // 0.0 – 1.0
  paymentHistoryRate: number;       // % on-time payments
  delinquencies: Delinquency[];
  hardInquiries: Inquiry[];
  createdAt: string;                // ISO8601
  lastUpdatedAt: string;
  frozenAt?: string;                // If credit is frozen (e.g., sanctions)
}

export interface ScoreFactor {
  code: string;   // e.g. 'HIGH_UTILIZATION', 'LATE_PAYMENT', 'SHORT_HISTORY'
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number; // 0–100, relative contribution
}

export type CreditEventType =
  | 'payment_on_time'
  | 'payment_late_30'
  | 'payment_late_60'
  | 'payment_late_90'
  | 'default'
  | 'credit_opened'
  | 'credit_closed'
  | 'hard_inquiry'
  | 'dispute_filed'
  | 'dispute_resolved'
  | 'score_updated'
  | 'sanctions_hit'
  | 'identity_verified';

export interface CreditEvent {
  id: string;
  agentId: string;
  eventType: CreditEventType;
  amount?: number;
  creditorId?: string;
  description: string;
  timestamp: string;
  onChainTxHash?: string;
  proofId?: string;                 // ZK proof ID if privacy mode
}

export interface Delinquency {
  id: string;
  creditorId: string;
  amount: number;
  daysLate: number;                 // 30, 60, 90
  openedAt: string;
  resolvedAt?: string;
  status: 'open' | 'resolved' | 'charged_off';
}

export interface Inquiry {
  id: string;
  requestorId: string;             // Lender who pulled the report
  requestorName: string;
  purpose: 'credit_application' | 'account_review' | 'employment' | 'insurance';
  timestamp: string;
  consentToken: string;            // Signed consent from agent
}

export interface CreditReport {
  reportId: string;
  agentId: string;
  requestorId: string;
  generatedAt: string;
  expiresAt: string;               // Reports expire after 90 days
  profile: AgentCreditProfile;
  summary: {
    score: number;
    tier: CreditTier;
    recommendation: 'approve' | 'approve_with_conditions' | 'decline' | 'manual_review';
    maxRecommendedLimit: number;   // USD
    riskGrade: 'A' | 'B' | 'C' | 'D' | 'F';
    creditGrade?: import('./grade').CreditGrade;  // AAA–D bureau letter grade
    inquiryFeeUsd?: number;                       // $2.80 per pull, metered
  };
  zkProofMode: boolean;            // If true, uses ZK proofs instead of raw history
  zkProofs?: ZKProof[];
}

export type ZKCircuit =
  | 'score_above'
  | 'no_default_last_n_months'
  | 'debt_under'
  | 'utilization_below';

export interface ZKProof {
  circuit: ZKCircuit;
  params: Record<string, number>;
  proofHash: string;               // Groth16 proof hash (stub)
  verified: boolean;
  generatedAt: string;
}

export type DisputeStatus =
  | 'open'
  | 'investigating'
  | 'resolved_upheld'
  | 'resolved_corrected'
  | 'resolved_deleted';

export interface Dispute {
  id: string;
  agentId: string;
  eventId: string;                 // The CreditEvent being disputed
  status: DisputeStatus;
  filedAt: string;
  resolvedAt?: string;
  description: string;
  evidence?: string;               // Base64 encoded document
  furnisherId?: string;            // The data contributor who submitted the bad data
  resolution?: string;
  escalatedAt?: string;            // If 30-day timer exceeded
}

export interface ScoreSimulation {
  agentId: string;
  currentScore: number;
  scenarios: {
    description: string;
    action: string;
    newScore: number;
    scoreDelta: number;
    timeToEffect: string;          // e.g., "30 days"
  }[];
}

export type DataContributorType =
  | 'defi_protocol'
  | 'cefi_lender'
  | 'saas_platform'
  | 'bank'
  | 'forgepay_internal';

export interface DataContributor {
  id: string;
  name: string;
  type: DataContributorType;
  apiKey: string;
  permissions: string[];
  queriesUsed: number;
  queriesAllowed: number;          // Based on data contributed
  dataRecordsContributed: number;
  createdAt: string;
  status: 'active' | 'suspended' | 'pending';
}

// ── Dual-Mode Scoring Types ───────────────────────────────────────────────────

/**
 * Mode 1: FORGE FICO (off-chain, deterministic, <15ms).
 * Credit decisioning lens — authoritative for lending decisions.
 * Weights: Payment History 35%, Utilization 30%, Age 15%, Mix 10%, Velocity 10%
 */
export interface Mode1Score {
  score: number;                   // 0-1000
  tier: CreditTier;
  factors: ScoreFactor[];
  recommendation: 'approve' | 'approve_with_conditions' | 'manual_review' | 'decline';
  maxRecommendedLimit: number;
  riskGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  computedAt: string;              // ISO8601
  latencyMs: number;
  source: 'FORGE_FICO_OFFCHAIN';
}

/**
 * Mode 2: On-chain operational score (Qova-derived, settled via Chainlink CRE).
 * Behavioral lens — used for bank audit trails and cross-chain portability.
 * Weights: Success Rate 30%, Volume 25%, Count 20%, Budget Compliance 15%, Age 10%
 */
export interface Mode2Score {
  score: number;                   // 0-1000
  tier: CreditTier;
  factors: ScoreFactor[];
  txHash?: string;                 // On-chain settlement tx hash
  blockNumber?: number;
  chainId?: number;
  settledAt?: string;              // ISO8601 — when settled on-chain
  source: 'FORGE_OPERATIONAL_ONCHAIN';
  verifiableOnChain: boolean;
}

/**
 * Consensus level between Mode 1 and Mode 2.
 * HIGH = both agree within 50 pts → high confidence
 * MEDIUM = variance 51-100 pts → flag for review
 * LOW = variance >100 pts → manual review required
 */
export type ConsensusLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DualModeScore {
  agentId: string;
  mode1: Mode1Score;
  mode2: Mode2Score | null;        // null when not yet settled on-chain
  consensus: {
    level: ConsensusLevel;
    variance: number;              // |mode1.score - mode2.score|
    authoritative: 'MODE_1';      // Mode 1 is always the lending decision
    recommendation: string;       // Human-readable consensus summary
    flagForReview: boolean;
  };
  generatedAt: string;
}

/**
 * Inputs for Mode 2 operational scoring — sourced from on-chain ForgeTransactionValidator.
 * These are the Qova-derived factors computed off the raw TransactionStats struct.
 */
export interface Mode2Inputs {
  successRateBps: number;          // basis points: 9500 = 95%
  totalVolumeUsd: number;
  totalCount: number;
  budgetComplianceRate: number;    // 0.0-1.0: fraction of spend attempts within budget
  accountAgeMonths: number;
  onChainSettled: boolean;         // whether ForgeReputationRegistry has a score
  onChainScore?: number;           // the settled on-chain score (0-1000) if available
}
