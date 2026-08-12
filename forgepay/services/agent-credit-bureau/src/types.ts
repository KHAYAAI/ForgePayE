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
  /**
   * The EVM account this agent settles from, EIP-55 checksummed.
   *
   * Held explicitly rather than string-sliced out of `did`. An address is a
   * capability (which on-chain account) and a DID is an identifier (who) —
   * conflating them is why only one hand-written DID format ever resolved and
   * why every real agent was silently skipped at settlement.
   *
   * Auto-populated when `did` is the self-certifying `did:forge:0x…` form;
   * otherwise supplied by the caller. Undefined means this agent cannot settle
   * on-chain yet, which `settlementEligibility()` reports explicitly.
   */
  evmAddress?: string;
  operatorEntityId: string;         // Legal entity (EIN/VAT/TRN) bound to this agent
  operatorEntityType: 'individual' | 'llc' | 'corp' | 'dao';
  /**
   * The operator's legal name — a person's or a business's. Optional: an EIN
   * or VAT number is not itself matchable against a sanctions list, which
   * screens by name. Without this, real entity screening cannot run for this
   * agent and sanctionsScreen() falls back to address-only (or local-only)
   * checking, which it reports honestly rather than silently.
   */
  operatorLegalName?: string;
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
  /**
   * Who extended the credit. Server-set from the authenticated furnisher on
   * ingest — a furnisher may only report credit it extended itself, so this is
   * never trusted from the request body.
   */
  creditorId?: string;
  description: string;
  timestamp: string;
  onChainTxHash?: string;

  /**
   * Which furnisher supplied this record. Server-set from the authenticated
   * principal; a furnisher cannot attribute a record to anyone else.
   *
   * Without this the 25% revenue share the product promises ("apportioned by
   * contribution") is not computable, and a dispute cannot identify the
   * furnisher that has to be notified.
   */
  contributorId?: string;

  /**
   * The furnisher's own identifier for this event, unique per furnisher.
   *
   * Makes ingest idempotent: a retried batch is recognised rather than written
   * twice. Replaces a `proofId: randomUUID()` that was generated server-side on
   * every ingest and therefore identified nothing.
   */
  externalId?: string;
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
  /**
   * The `jti` of the consent token that authorised this pull — not the token
   * itself, which is a bearer credential. This is the durable, non-replayable
   * reference tying the inquiry to the authorisation that permitted it.
   */
  consentToken: string;
  /**
   * The billing ledger entry that charged INQUIRY_FEE_USD for this pull.
   * Every recorded inquiry was successfully charged — billing runs before the
   * inquiry is recorded, and a declined charge never reaches this far — so
   * this ties revenue accounting back to the specific pull that earned it.
   */
  billingTransactionId?: string;
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
  /**
   * sha256 of the issued API key. The raw key is returned once at registration
   * and never stored — it was previously kept in plaintext here, in Postgres,
   * and served to unauthenticated callers by `GET /v1/contributors/:id/stats`.
   */
  apiKeyHash: string;
  permissions: string[];
  queriesUsed: number;
  queriesAllowed: number;          // Based on data contributed
  dataRecordsContributed: number;
  createdAt: string;
  status: 'active' | 'suspended' | 'pending';

  /** Why the status was last changed, and by whom. Set by the admin route. */
  statusReason?: string;
  statusChangedAt?: string;

  /**
   * Rolling ingest window. `dataRecordsContributed` raises this furnisher's own
   * quota (and, per the published revenue share, its own payout), so growth is
   * capped per window rather than being unbounded and self-reported. The
   * counters also make a captured-furnisher spike visible.
   */
  windowStartedAt?: string;
  recordsThisWindow?: number;
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

// ── Billing ───────────────────────────────────────────────────────────────────

/**
 * A requestor's (lender's, furnisher's, or agent operator's) prepaid USD
 * balance. Funded via x402 USDC top-ups or a manual admin credit; debited
 * synchronously at INQUIRY_FEE_USD per credit-file pull.
 */
export interface BillingAccount {
  requestorId: string;
  balanceUsdCents: number;
  createdAt: string;
  updatedAt: string;
}

export type BillingTransactionType = 'credit' | 'debit';

/** An append-only ledger entry. Never mutated once written. */
export interface BillingTransaction {
  id: string;
  requestorId: string;
  type: BillingTransactionType;
  amountUsdCents: number;
  /** Account balance immediately after this transaction, for a self-checking ledger. */
  balanceAfterUsdCents: number;
  reason: string;
  createdAt: string;
}

/**
 * An x402 USDC top-up in flight against stablecoin-gateway's `/x402` routes.
 * Tracked locally so a top-up can only ever be credited to the ledger once,
 * even if `POST /v1/billing/:requestorId/topup/:receiptId/confirm` is called
 * more than once (retries, double-clicks).
 */
export interface TopUpReceipt {
  receiptId: string;
  requestorId: string;
  amountUsd: number;
  status: 'pending' | 'confirmed';
  createdAt: string;
  confirmedAt?: string;
}
