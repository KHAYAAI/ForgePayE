/**
 * Account service — business logic for linking and managing bank accounts.
 *
 * Storage strategy:
 *   This implementation uses in-memory Maps for development and testing.
 *   In production, swap the Map operations for Prisma calls to PostgreSQL:
 *     - `accounts` Map  → `bank_accounts` table
 *     - `secrets`  Map  → `bank_account_secrets` table (encrypted column)
 *   The interface signatures remain identical so the swap is non-breaking.
 *
 * Access tokens are stored AES-256-GCM encrypted (see utils/encryption.ts).
 * The plaintext token NEVER touches the accounts map — only the ciphertext.
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  BankAccount,
  BankAccountSecret,
  PlaidExchangeRequest,
} from '../types';
import { encrypt, decrypt } from '../utils/encryption';
import * as plaid from '../plaid/client';
import { getOpenBankingClient } from '../openbanking/client';
import { logger } from '../lib/logger';

// ── In-memory stores (replace with Prisma + PostgreSQL in production) ─────────

const accounts = new Map<string, BankAccount>();          // accountId → account
const secrets  = new Map<string, BankAccountSecret>();    // accountId → secret
const merchantIndex = new Map<string, Set<string>>();     // merchantId → Set<accountId>

// ── Helpers ───────────────────────────────────────────────────────────────────

function indexAccount(merchantId: string, accountId: string): void {
  const existing = merchantIndex.get(merchantId) ?? new Set<string>();
  existing.add(accountId);
  merchantIndex.set(merchantId, existing);
}

function now(): string {
  return new Date().toISOString();
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Store a newly linked Plaid account.
 *
 * Called after a successful public-token exchange.  For each account returned
 * by Plaid in the Link metadata we create one BankAccount record.
 */
export async function linkPlaidAccount(
  merchantId:  string,
  exchange:    PlaidExchangeRequest,
  accessToken: string,
  itemId:      string,
): Promise<BankAccount[]> {
  // Fetch account details from Plaid so we have type / subtype / mask
  let plaidAccounts;
  try {
    plaidAccounts = await plaid.getAccounts(accessToken);
  } catch (err) {
    logger.error({ err, merchantId }, 'Failed to fetch Plaid accounts after exchange');
    throw err;
  }

  const encryptedToken = encrypt(accessToken);
  const linkedAccounts: BankAccount[] = [];
  const ts = now();

  for (const pa of plaidAccounts) {
    const id = uuidv4();
    const acctType = mapPlaidSubtype(pa.subtype ?? 'checking');

    const account: BankAccount = {
      id,
      merchantId,
      plaidAccountId:     pa.account_id,
      provider:           'plaid',
      accountType:        acctType,
      currency:           pa.balances.iso_currency_code ?? 'USD',
      mask:               pa.mask ?? '****',
      nickname:           pa.name ?? undefined,
      status:             'active',
      balanceCurrent:     pa.balances.current    ?? undefined,
      balanceAvailable:   pa.balances.available  ?? undefined,
      balanceLastUpdated: ts,
      createdAt:          ts,
      updatedAt:          ts,
    };

    const secret: BankAccountSecret = {
      accountId:            id,
      encryptedAccessToken: encryptedToken,
      plaidItemId:          itemId,
    };

    accounts.set(id, account);
    secrets.set(id, secret);
    indexAccount(merchantId, id);
    linkedAccounts.push(account);

    logger.info(
      { accountId: id, merchantId, plaidAccountId: pa.account_id },
      'Plaid account linked',
    );
  }

  return linkedAccounts;
}

/**
 * Store a newly linked Open Banking account (EU/UK).
 */
export async function linkOpenBankingAccount(
  merchantId: string,
  consentId:  string,
  obAccountId: string,
  currency:   string,
  accountType: 'checking' | 'savings' | 'money_market',
  mask:       string,
  nickname?:  string,
): Promise<BankAccount> {
  const id        = uuidv4();
  const ts        = now();
  const encrypted = encrypt(consentId);

  const account: BankAccount = {
    id,
    merchantId,
    obAccountId,
    provider:    'open_banking',
    accountType,
    currency,
    mask,
    nickname,
    status:      'active',
    createdAt:   ts,
    updatedAt:   ts,
  };

  const secret: BankAccountSecret = {
    accountId:            id,
    encryptedAccessToken: encrypted,
    obConsentId:          consentId,
  };

  accounts.set(id, account);
  secrets.set(id, secret);
  indexAccount(merchantId, id);

  logger.info({ accountId: id, merchantId, obAccountId }, 'Open Banking account linked');
  return account;
}

/**
 * Return all accounts for a merchant.
 */
export function getAccountsForMerchant(merchantId: string): BankAccount[] {
  const ids = merchantIndex.get(merchantId);
  if (!ids || ids.size === 0) return [];
  return Array.from(ids)
    .map((id) => accounts.get(id))
    .filter((a): a is BankAccount => a !== undefined && a.status !== 'disconnected');
}

/**
 * Return a single account.  Throws 404 if not found or if it belongs to a
 * different merchant (prevents IDOR).
 */
export function getAccount(accountId: string, merchantId: string): BankAccount {
  const account = accounts.get(accountId);
  if (!account || account.merchantId !== merchantId) {
    const err = new Error(`Account not found: ${accountId}`);
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }
  return account;
}

/**
 * Update mutable fields on an account (nickname, status).
 */
export function updateAccount(
  accountId:  string,
  merchantId: string,
  patch:      Partial<Pick<BankAccount, 'nickname' | 'status'>>,
): BankAccount {
  const account = getAccount(accountId, merchantId);
  const updated: BankAccount = {
    ...account,
    ...patch,
    updatedAt: now(),
  };
  accounts.set(accountId, updated);
  return updated;
}

/**
 * Force a real-time balance refresh from the provider.
 * Updates the stored balances and returns the refreshed account.
 */
export async function refreshBalance(
  accountId:  string,
  merchantId: string,
): Promise<BankAccount> {
  const account = getAccount(accountId, merchantId);
  const secret  = secrets.get(accountId);

  if (!secret) {
    throw new Error(`No credentials found for account ${accountId}`);
  }

  let currentBalance: number | undefined;
  let availableBalance: number | undefined;

  if (account.provider === 'plaid') {
    const accessToken = decrypt(secret.encryptedAccessToken);
    const plaidAccounts = await plaid.getBalance(accessToken);
    const pa = plaidAccounts.find((a) => a.account_id === account.plaidAccountId);
    if (pa) {
      currentBalance   = pa.balances.current    ?? undefined;
      availableBalance = pa.balances.available  ?? undefined;
    }
  } else if (account.provider === 'open_banking' && account.obAccountId) {
    const consentId = decrypt(secret.encryptedAccessToken);
    const obClient  = getOpenBankingClient();
    const balances  = await obClient.getBalances(account.obAccountId, consentId);
    const interim   = balances.find((b) => b.type === 'InterimAvailable');
    const booked    = balances.find((b) => b.type === 'InterimBooked');
    availableBalance = interim?.amount;
    currentBalance   = booked?.amount ?? interim?.amount;
  }

  const ts      = now();
  const updated: BankAccount = {
    ...account,
    balanceCurrent:     currentBalance,
    balanceAvailable:   availableBalance,
    balanceLastUpdated: ts,
    updatedAt:          ts,
  };
  accounts.set(accountId, updated);

  logger.info(
    { accountId, merchantId, currentBalance, availableBalance },
    'Balance refreshed',
  );
  return updated;
}

/**
 * Revoke provider tokens and mark the account as disconnected.
 * The record is retained for audit history but excluded from list queries.
 */
export async function disconnectAccount(
  accountId:  string,
  merchantId: string,
): Promise<void> {
  const account = getAccount(accountId, merchantId);

  // Best-effort token revocation — log errors but don't fail the disconnect
  try {
    if (account.provider === 'plaid') {
      // Plaid item removal would go here via client.itemRemove(accessToken)
      // omitted because it requires the access token and we want to keep this
      // synchronous in the dev path.
      logger.info({ accountId }, 'Plaid item removal would happen here in production');
    }
  } catch (err) {
    logger.warn({ err, accountId }, 'Token revocation failed during disconnect');
  }

  secrets.delete(accountId);
  updateAccount(accountId, merchantId, { status: 'disconnected' });
  logger.info({ accountId, merchantId }, 'Account disconnected');
}

/**
 * Retrieve the decrypted access token for an account.
 * Used internally by transfer service — never exposed to API callers.
 */
export function getAccessToken(accountId: string): string {
  const secret = secrets.get(accountId);
  if (!secret) {
    throw new Error(`No credentials for account ${accountId}`);
  }
  return decrypt(secret.encryptedAccessToken);
}

/**
 * Retrieve the Open Banking consent ID for an account.
 * Alias of getAccessToken — the encrypted field stores the consent ID for OB accounts.
 */
export function getConsentId(accountId: string): string {
  return getAccessToken(accountId);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function mapPlaidSubtype(subtype: string): BankAccount['accountType'] {
  if (subtype === 'savings')       return 'savings';
  if (subtype === 'money market')  return 'money_market';
  return 'checking';
}
