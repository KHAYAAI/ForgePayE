/**
 * FORGE Wallet in-memory store + domain operations.
 * ──────────────────────────────────────────────────────────────────────────────
 * The in-memory maps are the source of truth in dev (same idiom as
 * enterprise-treasury); every mutation is mirrored to Postgres best-effort via
 * db.ts persistence helpers when the DB is available.
 *
 * Security invariants enforced here:
 *   - plaintext private keys are never stored (only AES-256-GCM envelopes)
 *   - recovery tokens are stored as sha256 hashes only
 *   - the transactions map is append-only: records transition status forward
 *     but are never removed
 */

import { randomUUID, randomBytes } from 'node:crypto';
import {
  CHAIN_ADAPTERS,
  encryptPrivateKey,
  generateWalletKeypair,
  sha256,
} from './crypto';
import {
  persistEncryptedKey,
  persistGasSponsorship,
  persistRecoveryApproval,
  persistRecoveryRequest,
  persistTransaction,
  persistTransactionEvent,
  persistTrustedContact,
  persistUser,
  persistWallet,
} from './db';
import { gasSponsoredUsdTotal, transactionsTotal, walletsCreatedTotal } from './lib/metrics';
import type {
  AgentIdentity,
  Blockchain,
  DidType,
  EncryptedKey,
  GasSponsorship,
  RecoveryApproval,
  RecoveryRequest,
  TransactionEvent,
  TransactionStatus,
  TrustedContact,
  User,
  Wallet,
  WalletTransaction,
} from './types';
import { SUPPORTED_CHAINS } from './types';

export const GAS_SPONSORSHIP_USD_PER_TX = 0.10; // placeholder rate for billing
export const MAX_TRUSTED_CONTACTS = 3;
export const REQUIRED_RECOVERY_APPROVALS = 2;   // 2-of-3
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;    // 24h

// ── State ─────────────────────────────────────────────────────────────────────

const users = new Map<string, User>();
const usersByEmail = new Map<string, string>();
const agents = new Map<string, AgentIdentity>();
const encryptedKeys = new Map<string, EncryptedKey>();
const wallets = new Map<string, Wallet>();
const walletsByAddress = new Map<string, string>();
const transactions = new Map<string, WalletTransaction>();
const transactionEvents: TransactionEvent[] = [];
const trustedContacts = new Map<string, TrustedContact>();
const recoveryRequests = new Map<string, RecoveryRequest>();
const recoveryApprovals = new Map<string, RecoveryApproval>();
const gasLedger: GasSponsorship[] = [];

/** Test-only: reset all in-memory state. */
export function resetStore(): void {
  users.clear(); usersByEmail.clear(); agents.clear();
  encryptedKeys.clear(); wallets.clear(); walletsByAddress.clear();
  transactions.clear(); transactionEvents.length = 0;
  trustedContacts.clear(); recoveryRequests.clear(); recoveryApprovals.clear();
  gasLedger.length = 0;
}

const now = () => new Date().toISOString();

// ── Users & identities ────────────────────────────────────────────────────────

export function findUserByEmail(email: string): User | undefined {
  const id = usersByEmail.get(email.toLowerCase());
  return id ? users.get(id) : undefined;
}

export function getUser(id: string): User | undefined {
  return users.get(id);
}

export function updateUserPasswordHash(userId: string, passwordHash: string): void {
  const user = users.get(userId);
  if (!user) return;
  user.passwordHash = passwordHash;
  user.updatedAt = now();
  void persistUser(user);
}

// ── Wallet provisioning ───────────────────────────────────────────────────────

interface ProvisionResult {
  keyId: string;
  wallets: Wallet[];
}

/**
 * Generate an Ed25519 keypair, encrypt the private key under `secret`
 * (user password, or the one-time agent signing secret), and derive one
 * wallet per supported chain. The plaintext private key never leaves this
 * function's scope.
 */
function provisionWallets(ownerId: string, ownerType: DidType, did: string, secret: string, version = 1): ProvisionResult {
  const { publicKeyPem, privateKeyPem } = generateWalletKeypair();
  const envelope = encryptPrivateKey(privateKeyPem, secret);

  const key: EncryptedKey = {
    id: `key_${randomUUID()}`,
    ownerId,
    publicKeyPem,
    ...envelope,
    version,
    createdAt: now(),
  };
  encryptedKeys.set(key.id, key);
  void persistEncryptedKey(key);

  const created: Wallet[] = SUPPORTED_CHAINS.map((chain: Blockchain) => {
    const wallet: Wallet = {
      id: `wal_${randomUUID()}`,
      ownerId,
      ownerType,
      did,
      blockchain: chain,
      address: CHAIN_ADAPTERS[chain].deriveAddress(publicKeyPem),
      keyId: key.id,
      status: 'active',
      vaultBackupPath: `vault:secret/forge-wallet/backup/${ownerId}/v${version}`,
      createdAt: now(),
      rotatedAt: null,
    };
    wallets.set(wallet.id, wallet);
    walletsByAddress.set(wallet.address, wallet.id);
    void persistWallet(wallet);
    walletsCreatedTotal.inc({ type: ownerType });
    return wallet;
  });

  return { keyId: key.id, wallets: created };
}

export function createUser(email: string, passwordHash: string, password: string, name: string | null): { user: User; wallets: Wallet[] } {
  const id = `user_${randomUUID()}`;
  const user: User = {
    id,
    did: `did:forge:${id}`,
    email: email.toLowerCase(),
    name,
    passwordHash,
    totpSecret: null,
    totpEnabled: false,
    createdAt: now(),
    updatedAt: now(),
  };
  users.set(id, user);
  usersByEmail.set(user.email, id);
  void persistUser(user);

  const { wallets: userWallets } = provisionWallets(id, 'user', user.did, password);
  return { user, wallets: userWallets };
}

/**
 * Agent wallets: agents have no password, so the private key is encrypted
 * under a one-time random signing secret returned exactly once to the
 * platform caller (which stores it in its own vault).
 */
export function createAgentWallets(name: string, ownerPlatform: string): { agent: AgentIdentity; wallets: Wallet[]; signingSecret: string } {
  const id = `agent_${randomUUID()}`;
  const agent: AgentIdentity = {
    id,
    did: `did:forge:${id}`,
    name,
    ownerPlatform,
    createdAt: now(),
  };
  agents.set(id, agent);

  const signingSecret = randomBytes(32).toString('base64url');
  const { wallets: agentWallets } = provisionWallets(id, 'agent', agent.did, signingSecret);
  return { agent, wallets: agentWallets, signingSecret };
}

export function getActiveWallets(ownerId: string): Wallet[] {
  return [...wallets.values()].filter((w) => w.ownerId === ownerId && w.status === 'active');
}

export function getActiveWallet(ownerId: string, chain: Blockchain): Wallet | undefined {
  return getActiveWallets(ownerId).find((w) => w.blockchain === chain);
}

export function getEncryptedKey(keyId: string): EncryptedKey | undefined {
  return encryptedKeys.get(keyId);
}

export function lookupDidByAddress(address: string): { did: string; type: DidType } | undefined {
  const walletId = walletsByAddress.get(address);
  if (!walletId) return undefined;
  const wallet = wallets.get(walletId)!;
  return { did: wallet.did, type: wallet.ownerType };
}

// ── Transactions (append-only) ────────────────────────────────────────────────

export function createTransaction(
  fields: Omit<WalletTransaction, 'id' | 'status' | 'signature' | 'txHash' | 'confirmations' | 'failureReason' | 'createdAt' | 'confirmedAt'>,
): WalletTransaction {
  const tx: WalletTransaction = {
    ...fields,
    id: `tx_${randomUUID()}`,
    status: 'created',
    signature: null,
    txHash: null,
    confirmations: 0,
    failureReason: null,
    createdAt: now(),
    confirmedAt: null,
  };
  transactions.set(tx.id, tx);
  void persistTransaction(tx);
  appendTransactionEvent(tx.id, 'created', null);
  transactionsTotal.inc({ status: 'created' });
  return tx;
}

export function transitionTransaction(
  txId: string,
  status: TransactionStatus,
  patch: Partial<Pick<WalletTransaction, 'signature' | 'txHash' | 'confirmations' | 'failureReason' | 'confirmedAt'>> = {},
  detail: string | null = null,
): WalletTransaction | undefined {
  const tx = transactions.get(txId);
  if (!tx) return undefined;
  tx.status = status;
  Object.assign(tx, patch);
  void persistTransaction(tx);
  appendTransactionEvent(txId, status, detail);
  transactionsTotal.inc({ status });
  return tx;
}

function appendTransactionEvent(transactionId: string, status: TransactionStatus, detail: string | null): void {
  const event: TransactionEvent = {
    id: `txe_${randomUUID()}`,
    transactionId,
    status,
    detail,
    at: now(),
  };
  transactionEvents.push(event);
  void persistTransactionEvent(event);
}

export function getTransaction(txId: string): WalletTransaction | undefined {
  return transactions.get(txId);
}

export function listTransactions(ownerId: string): WalletTransaction[] {
  return [...transactions.values()]
    .filter((t) => t.ownerId === ownerId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getTransactionEvents(txId: string): TransactionEvent[] {
  return transactionEvents.filter((e) => e.transactionId === txId);
}

// ── Gas sponsorship ledger ────────────────────────────────────────────────────

export function recordGasSponsorship(tx: WalletTransaction): GasSponsorship {
  const entry: GasSponsorship = {
    id: `gas_${randomUUID()}`,
    transactionId: tx.id,
    ownerId: tx.ownerId,
    blockchain: tx.blockchain,
    sponsoredUsd: GAS_SPONSORSHIP_USD_PER_TX,
    createdAt: now(),
  };
  gasLedger.push(entry);
  void persistGasSponsorship(entry);
  gasSponsoredUsdTotal.inc(GAS_SPONSORSHIP_USD_PER_TX);
  return entry;
}

export function listGasSponsorship(ownerId: string): GasSponsorship[] {
  return gasLedger.filter((g) => g.ownerId === ownerId);
}

// ── Social recovery (2-of-3) ──────────────────────────────────────────────────

export function listTrustedContacts(userId: string): TrustedContact[] {
  return [...trustedContacts.values()].filter((c) => c.userId === userId);
}

export function addTrustedContact(userId: string, email: string, name: string | null): TrustedContact | { error: string } {
  const existing = listTrustedContacts(userId);
  if (existing.length >= MAX_TRUSTED_CONTACTS) {
    return { error: `Maximum of ${MAX_TRUSTED_CONTACTS} trusted contacts` };
  }
  if (existing.some((c) => c.email === email.toLowerCase())) {
    return { error: 'Contact already registered' };
  }
  const contact: TrustedContact = {
    id: `tc_${randomUUID()}`,
    userId,
    email: email.toLowerCase(),
    name,
    createdAt: now(),
  };
  trustedContacts.set(contact.id, contact);
  void persistTrustedContact(contact);
  return contact;
}

export interface InitiatedRecovery {
  request: RecoveryRequest;
  /** Raw single-use tokens, one per trusted contact. In production these are
   *  emailed to contacts via email-service; only hashes are stored. */
  tokens: { contactId: string; contactEmail: string; token: string }[];
}

export function initiateRecovery(userId: string): InitiatedRecovery | { error: string } {
  const contacts = listTrustedContacts(userId);
  if (contacts.length < REQUIRED_RECOVERY_APPROVALS) {
    return { error: `Recovery requires at least ${REQUIRED_RECOVERY_APPROVALS} trusted contacts (found ${contacts.length})` };
  }

  const request: RecoveryRequest = {
    id: `rec_${randomUUID()}`,
    userId,
    status: 'pending',
    requiredApprovals: REQUIRED_RECOVERY_APPROVALS,
    createdAt: now(),
    expiresAt: new Date(Date.now() + RECOVERY_TTL_MS).toISOString(),
    completedAt: null,
  };
  recoveryRequests.set(request.id, request);
  void persistRecoveryRequest(request);

  const tokens = contacts.map((contact) => {
    const token = randomBytes(32).toString('hex');
    const approval: RecoveryApproval = {
      id: `ra_${randomUUID()}`,
      requestId: request.id,
      contactId: contact.id,
      tokenHash: sha256(token).toString('hex'),
      approvedAt: null,
    };
    recoveryApprovals.set(approval.id, approval);
    void persistRecoveryApproval(approval);
    return { contactId: contact.id, contactEmail: contact.email, token };
  });

  return { request, tokens };
}

export type ApprovalResult =
  | { request: RecoveryRequest; approvals: number }
  | { error: 'invalid_token' | 'already_used' | 'expired' };

export function approveRecovery(rawToken: string): ApprovalResult {
  const tokenHash = sha256(rawToken).toString('hex');
  const approval = [...recoveryApprovals.values()].find((a) => a.tokenHash === tokenHash);
  if (!approval) return { error: 'invalid_token' };
  if (approval.approvedAt) return { error: 'already_used' };

  const request = recoveryRequests.get(approval.requestId)!;
  if (request.status === 'completed' || new Date(request.expiresAt).getTime() < Date.now()) {
    if (request.status === 'pending') {
      request.status = 'expired';
      void persistRecoveryRequest(request);
    }
    return { error: 'expired' };
  }

  approval.approvedAt = now();
  void persistRecoveryApproval(approval);

  const approvals = [...recoveryApprovals.values()]
    .filter((a) => a.requestId === request.id && a.approvedAt !== null).length;
  if (approvals >= request.requiredApprovals && request.status === 'pending') {
    request.status = 'approved';
    void persistRecoveryRequest(request);
  }
  return { request, approvals };
}

export function getRecoveryRequest(id: string): RecoveryRequest | undefined {
  return recoveryRequests.get(id);
}

/**
 * Complete an approved recovery: the old password is lost, so the old private
 * key is unrecoverable in the dev implementation. We generate a fresh keypair
 * encrypted under the new password and mark the old wallets `rotated`.
 *
 * Production path: the Vault backup (vault_backup_path) holds Shamir shares
 * of the original key, so the SAME key is re-encrypted and addresses are kept.
 */
export function completeRecovery(requestId: string, newPassword: string): { request: RecoveryRequest; wallets: Wallet[] } | { error: string } {
  const request = recoveryRequests.get(requestId);
  if (!request) return { error: 'Recovery request not found' };
  if (request.status !== 'approved') return { error: `Recovery request is ${request.status}, not approved` };
  const user = users.get(request.userId);
  if (!user) return { error: 'User not found' };

  // Rotate old wallets
  let maxVersion = 0;
  for (const wallet of getActiveWallets(user.id)) {
    wallet.status = 'rotated';
    wallet.rotatedAt = now();
    void persistWallet(wallet);
    const key = encryptedKeys.get(wallet.keyId);
    if (key) maxVersion = Math.max(maxVersion, key.version);
  }

  const { wallets: freshWallets } = provisionWallets(user.id, 'user', user.did, newPassword, maxVersion + 1);

  request.status = 'completed';
  request.completedAt = now();
  void persistRecoveryRequest(request);

  return { request, wallets: freshWallets };
}
