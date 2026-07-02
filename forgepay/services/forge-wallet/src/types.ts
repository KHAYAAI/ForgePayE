/**
 * Shared types for FORGE Wallet.
 */

// ── Chains ────────────────────────────────────────────────────────────────────

export type Blockchain = 'ethereum' | 'polygon' | 'solana';

export const SUPPORTED_CHAINS: Blockchain[] = ['ethereum', 'polygon', 'solana'];

/**
 * ChainAdapter — abstraction boundary for real chain integrations.
 *
 * The dev implementation (DeterministicDevAdapter in crypto.ts) derives
 * addresses as a documented deterministic hash of the Ed25519 public key and
 * simulates broadcast. Production adapters (ethers.js / @solana/web3.js) plug
 * in behind this interface without touching route handlers.
 */
export interface ChainAdapter {
  chain: Blockchain;
  /** Derive a chain-native address from a PEM-encoded Ed25519 public key. */
  deriveAddress(publicKeyPem: string): string;
  /** Sign a 32-byte transaction hash; returns hex signature. */
  signTransactionHash(txHash: Buffer, privateKeyPem: string): string;
  /** Broadcast a signed transaction; returns the tx hash. */
  broadcast(signedPayload: BroadcastPayload): Promise<string>;
}

export interface BroadcastPayload {
  from_address: string;
  to_address: string;
  amount: number;
  currency: string;
  blockchain: Blockchain;
  signature: string;
  nonce: string;
}

// ── Identities ────────────────────────────────────────────────────────────────

export type DidType = 'user' | 'agent';

export interface User {
  id: string;                     // user_<uuid>
  did: string;                    // did:forge:user_<uuid>
  email: string;
  name: string | null;
  passwordHash: string;           // bcrypt, 12 rounds
  totpSecret: string | null;      // optional TOTP 2FA (enrollment stubbed)
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentIdentity {
  id: string;                     // agent_<uuid>
  did: string;                    // did:forge:agent_<uuid>
  name: string;
  ownerPlatform: string;
  createdAt: string;
}

// ── Wallets & keys ────────────────────────────────────────────────────────────

export type WalletStatus = 'active' | 'rotated';

export interface Wallet {
  id: string;                     // wal_<uuid>
  ownerId: string;                // user_* or agent_*
  ownerType: DidType;
  did: string;
  blockchain: Blockchain;
  address: string;
  keyId: string;                  // FK → EncryptedKey.id
  status: WalletStatus;
  vaultBackupPath: string;        // HashiCorp Vault backup reference (full stack)
  createdAt: string;
  rotatedAt: string | null;
}

/**
 * AES-256-GCM envelope for an Ed25519 private key.
 * KEK = scrypt(password, per-user salt). The plaintext private key is never
 * persisted and never returned by any endpoint.
 */
export interface EncryptedKey {
  id: string;                     // key_<uuid>
  ownerId: string;
  publicKeyPem: string;
  ciphertextHex: string;
  ivHex: string;
  authTagHex: string;
  saltHex: string;
  kdf: 'scrypt';
  kdfParams: { N: number; r: number; p: number; keyLen: number };
  cipher: 'aes-256-gcm';
  version: number;                // bumped on recovery re-key
  createdAt: string;
}

// ── Transactions ──────────────────────────────────────────────────────────────

export type TransactionStatus = 'created' | 'signed' | 'broadcast' | 'confirmed' | 'failed';

export interface WalletTransaction {
  id: string;                     // tx_<uuid>
  ownerId: string;
  did: string;
  walletId: string;
  blockchain: Blockchain;
  fromAddress: string;
  toAddress: string;
  amount: number;
  currency: string;
  paymentTerms: string | null;
  status: TransactionStatus;
  signature: string | null;
  txHash: string | null;
  confirmations: number;
  failureReason: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

/** Append-only status transition log entry. */
export interface TransactionEvent {
  id: string;
  transactionId: string;
  status: TransactionStatus;
  detail: string | null;
  at: string;
}

// ── Recovery ──────────────────────────────────────────────────────────────────

export interface TrustedContact {
  id: string;                     // tc_<uuid>
  userId: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export type RecoveryStatus = 'pending' | 'approved' | 'completed' | 'expired';

export interface RecoveryRequest {
  id: string;                     // rec_<uuid>
  userId: string;
  status: RecoveryStatus;
  requiredApprovals: number;      // 2-of-3
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export interface RecoveryApproval {
  id: string;                     // ra_<uuid>
  requestId: string;
  contactId: string;
  tokenHash: string;              // sha256 — raw token never stored
  approvedAt: string | null;
}

// ── Gas sponsorship ───────────────────────────────────────────────────────────

export interface GasSponsorship {
  id: string;                     // gas_<uuid>
  transactionId: string;
  ownerId: string;
  blockchain: Blockchain;
  sponsoredUsd: number;           // ~$0.10/tx placeholder
  createdAt: string;
}

// ── JWT ───────────────────────────────────────────────────────────────────────

export interface JwtClaims {
  sub: string;                    // user id
  did: string;
  email: string;
  iat: number;
  exp: number;
}
