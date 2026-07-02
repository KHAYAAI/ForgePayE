/**
 * Shared domain types for FORGE Custody.
 *
 * FORGE Custody = OpenFireblocks integrated into the FORGE ecosystem:
 * institutional digital-asset custody with 4-of-7 threshold (MPC) signing,
 * a per-workspace policy engine, and revenue-ontology settlement events.
 */

// ── Workspaces & auth ─────────────────────────────────────────────────────────

export interface Workspace {
  id: string;
  name: string;
  institutionType: 'bank' | 'fintech' | 'fund' | 'enterprise' | 'other';
  status: 'active' | 'suspended';
  createdAt: string;
}

export interface ApiKeyRecord {
  id: string;
  workspaceId: string;
  /** sha256 hex of the raw API key — raw key material is never stored. */
  keyHash: string;
  name: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

// ── Policy engine ─────────────────────────────────────────────────────────────

/** Allowed days (0=Sunday..6=Saturday) and hours [startHour, endHour) in UTC. */
export interface TimeWindowRule {
  days: number[];
  startHour: number;
  endHour: number;
}

export interface ApprovalThresholdRule {
  /** Signing requests with amountUsd >= this require approvals. */
  amountUsd: number;
  approvalsRequired: number;
  /** Roles that must approve, e.g. ['CFO', 'CEO']. When set, approvals must come from distinct roles in this list. */
  roles?: string[];
}

export interface PolicyRules {
  /** Aggregate USD signable per UTC day per workspace. */
  dailyLimitUsd?: number;
  /** Allowed destination addresses (case-insensitive). */
  whitelist?: string[];
  timeWindow?: TimeWindowRule;
  approvalThreshold?: ApprovalThresholdRule;
  /** e.g. ['ethereum', 'polygon'] */
  allowedChains?: string[];
}

export interface Policy {
  id: string;
  workspaceId: string;
  name: string;
  enabled: boolean;
  rules: PolicyRules;
  createdAt: string;
  updatedAt: string;
}

export type PolicyReasonCode =
  | 'DAILY_LIMIT_EXCEEDED'
  | 'DESTINATION_NOT_WHITELISTED'
  | 'OUTSIDE_TIME_WINDOW'
  | 'CHAIN_NOT_ALLOWED'
  | 'SANCTIONS_HIT'
  | 'SANCTIONS_SCREENING_FAILED'
  | 'KEY_NOT_ACTIVE'
  | 'KEY_NOT_FOUND';

export interface PolicyDecision {
  allowed: boolean;
  reasonCode?: PolicyReasonCode;
  requiresApproval?: boolean;
  approvalsRequired?: number;
  approverRoles?: string[];
}

// ── Key management ────────────────────────────────────────────────────────────

export type RotationStatus = 'active' | 'rotating' | 'retired';

export interface CustodyKey {
  id: string;
  workspaceId: string;
  blockchain: string;
  publicKey: string;
  address: string;
  /** 4-of-7 threshold semantics by default. */
  totalShares: number;
  threshold: number;
  /** Named holders of the encrypted key shares (metadata only). */
  shareHolders: string[];
  /**
   * Vault reference where the encrypted shares live (e.g. secret/forge-custody/ws_x/key_y).
   * Key material itself is NEVER stored in Postgres — only this path.
   */
  vaultPath: string;
  rotationStatus: RotationStatus;
  createdAt: string;
}

// ── DKG ceremonies ────────────────────────────────────────────────────────────

export interface CeremonyParticipant {
  participantId: string;
  role?: string;
}

export interface Ceremony {
  id: string;
  workspaceId: string;
  ceremonyType: 'dkg';
  participants: CeremonyParticipant[];
  /** Feldman VSS commitments, stored as sha256 hex hashes. */
  vssCommitments: string[];
  commitmentsVerified: boolean;
  /** Key produced by the ceremony. */
  keyId: string | null;
  createdAt: string;
}

// ── Signing requests ──────────────────────────────────────────────────────────

export type SigningStatus =
  | 'pending_policy'
  | 'pending_approval'
  | 'approved'
  | 'signing'
  | 'broadcast'
  | 'confirmed'
  | 'rejected'
  | 'failed';

export interface TransactionPayload {
  to: string;
  data?: string;
  /** Native-unit value as a decimal string (wei for EVM chains). */
  value: string;
  gas?: string;
  gasPrice?: string;
}

export interface SigningMetadata {
  forge_payment_id?: string;
  forge_merchant_id?: string;
  agent_id?: string;
  credit_line_id?: string;
  [key: string]: unknown;
}

export interface SigningRequest {
  id: string;
  workspaceId: string;
  customerId: string;
  keyId: string;
  blockchain: string;
  transaction: TransactionPayload;
  metadata: SigningMetadata;
  amountUsd: number;
  status: SigningStatus;
  reasonCode: PolicyReasonCode | null;
  approvalsRequired: number;
  approverRoles: string[];
  signature: string | null;
  txHash: string | null;
  blockNumber: number | null;
  confirmationTime: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SigningApproval {
  id: string;
  signingRequestId: string;
  approverId: string;
  approverRole: string;
  approvedAt: string;
}

export interface SigningShare {
  id: string;
  signingRequestId: string;
  shareIndex: number;
  holder: string;
  /** sha256 hash of the share contribution — never the share itself. */
  contributionHash: string;
  createdAt: string;
}

// ── Audit log (append-only) ───────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  workspaceId: string | null;
  apiKeyId: string | null;
  actor: string;
  method: string;
  path: string;
  action: string;
  resourceId: string | null;
  statusCode: number | null;
  detail: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

// ── Settlement events ─────────────────────────────────────────────────────────

export interface CustodyConfirmedEvent {
  event_type: 'custody.signature.confirmed';
  actor_id: string;
  amount: number;
  currency: string;
  blockchain: string;
  from_address: string;
  to_address: string;
  tx_hash: string;
  metadata: SigningMetadata & { signing_id: string; forge_workspace_id: string };
}
