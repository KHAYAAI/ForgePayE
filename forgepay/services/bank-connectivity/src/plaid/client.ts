/**
 * Plaid API client wrapper for the ForgePay bank-connectivity service.
 *
 * Thin adapter around the official `plaid` npm package.  All methods
 * translate Plaid SDK calls into our internal domain types and surface
 * typed errors instead of letting raw Plaid errors bubble up to route
 * handlers.
 *
 * Required env vars:
 *   PLAID_CLIENT_ID  — from the Plaid dashboard
 *   PLAID_SECRET     — sandbox / development / production secret
 *   PLAID_ENV        — "sandbox" | "development" | "production"
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
  TransferType,
  TransferNetwork,
  ACHClass,
} from 'plaid';
import type {
  AccountBase,
  Transaction,
  LinkTokenCreateRequest,
  TransferCreateRequest,
} from 'plaid';
import { logger } from '../lib/logger';

// ── Client singleton ──────────────────────────────────────────────────────────

let _client: PlaidApi | null = null;

function getClient(): PlaidApi {
  if (_client) return _client;

  const clientId = process.env.PLAID_CLIENT_ID;
  const secret   = process.env.PLAID_SECRET;
  const env      = (process.env.PLAID_ENV ?? 'sandbox') as keyof typeof PlaidEnvironments;

  if (!clientId || !secret) {
    throw new Error('PLAID_CLIENT_ID and PLAID_SECRET env vars must be set');
  }

  const baseURL = PlaidEnvironments[env] ?? PlaidEnvironments.sandbox;

  const config = new Configuration({
    basePath: baseURL,
    baseOptions: {
      headers: {
        'PLAID-CLIENT-ID': clientId,
        'PLAID-SECRET':    secret,
      },
    },
  });

  _client = new PlaidApi(config);
  logger.info({ env }, 'Plaid client initialised');
  return _client;
}

// ── Public helpers ────────────────────────────────────────────────────────────

/**
 * Create a Plaid Link token that the front-end uses to open the Link UI.
 * `userId` is the Plaid-side user identifier (stable per end-user).
 * `merchantId` is stored as the client_user_id for audit purposes.
 */
export async function createLinkToken(
  userId: string,
  merchantId: string,
): Promise<{ linkToken: string; expiration: string; requestId: string }> {
  const client = getClient();

  const request: LinkTokenCreateRequest = {
    user:          { client_user_id: merchantId },
    client_name:   'ForgePay',
    products:      [Products.Transactions, Products.Balance],
    country_codes: [CountryCode.Us],
    language:      'en',
    // Link customisation can be added here (webhook URL, redirect URI, etc.)
    webhook:       process.env.PLAID_WEBHOOK_URL ?? undefined,
  };

  try {
    const res = await client.linkTokenCreate(request);
    return {
      linkToken:  res.data.link_token,
      expiration: res.data.expiration,
      requestId:  res.data.request_id,
    };
  } catch (err) {
    logger.error({ err, userId, merchantId }, 'Plaid linkTokenCreate failed');
    throw wrapPlaidError(err, 'Failed to create Plaid link token');
  }
}

/**
 * Exchange a short-lived public_token (from Link) for a durable access_token.
 * Call this exactly once immediately after the user completes Link.
 */
export async function exchangePublicToken(
  publicToken: string,
): Promise<{ accessToken: string; itemId: string }> {
  const client = getClient();

  try {
    const res = await client.itemPublicTokenExchange({ public_token: publicToken });
    return {
      accessToken: res.data.access_token,
      itemId:      res.data.item_id,
    };
  } catch (err) {
    logger.error({ err }, 'Plaid itemPublicTokenExchange failed');
    throw wrapPlaidError(err, 'Failed to exchange Plaid public token');
  }
}

/**
 * Retrieve all accounts (with balances) for the given access token.
 * Plaid populates balances inline when using /accounts/get.
 */
export async function getAccounts(accessToken: string): Promise<AccountBase[]> {
  const client = getClient();

  try {
    const res = await client.accountsGet({ access_token: accessToken });
    return res.data.accounts;
  } catch (err) {
    logger.error({ err }, 'Plaid accountsGet failed');
    throw wrapPlaidError(err, 'Failed to retrieve Plaid accounts');
  }
}

/**
 * Fetch real-time balance data.  More network-intensive than accountsGet
 * because Plaid goes to the institution in real time rather than serving
 * cached data.  Use for on-demand balance refreshes.
 */
export async function getBalance(accessToken: string): Promise<AccountBase[]> {
  const client = getClient();

  try {
    const res = await client.accountsBalanceGet({ access_token: accessToken });
    return res.data.accounts;
  } catch (err) {
    logger.error({ err }, 'Plaid accountsBalanceGet failed');
    throw wrapPlaidError(err, 'Failed to retrieve Plaid balances');
  }
}

/**
 * Fetch transactions for the given date range (YYYY-MM-DD).
 * Results are paginated — this fetches up to `count` per call (max 500).
 */
export async function getTransactions(
  accessToken: string,
  startDate: string,
  endDate: string,
  offset = 0,
  count  = 100,
): Promise<{ transactions: Transaction[]; totalTransactions: number }> {
  const client = getClient();

  try {
    const res = await client.transactionsGet({
      access_token: accessToken,
      start_date:   startDate,
      end_date:     endDate,
      options:      { count, offset },
    });
    return {
      transactions:      res.data.transactions,
      totalTransactions: res.data.total_transactions,
    };
  } catch (err) {
    logger.error({ err, startDate, endDate }, 'Plaid transactionsGet failed');
    throw wrapPlaidError(err, 'Failed to retrieve Plaid transactions');
  }
}

export interface AchTransferParams {
  accessToken:      string
  accountId:        string   // Plaid account_id (not our internal id)
  amount:           number   // in major units (dollars)
  description:      string
  achClass?:        'ppd' | 'ccd' | 'web'
  legalName:        string   // account holder legal name
  idempotencyKey:   string
}

/**
 * Initiate an ACH transfer via the Plaid Transfer API.
 *
 * The modern Plaid Transfer flow is two-step:
 *   1. /transfer/authorization/create  → get an authorization_id
 *   2. /transfer/create                → execute using that authorization_id
 *
 * Returns the Plaid transfer id for status polling.
 *
 * NOTE: Plaid Transfer requires additional product enrollment in the
 * Plaid dashboard.  Sandbox works without additional approval.
 */
export async function initiateAchTransfer(
  params: AchTransferParams,
): Promise<{ transferId: string; status: string }> {
  const client = getClient();

  // Step 1: authorize the transfer
  let authorizationId: string;
  try {
    const authRes = await client.transferAuthorizationCreate({
      access_token: params.accessToken,
      account_id:   params.accountId,
      type:         TransferType.Debit,
      network:      TransferNetwork.Ach,
      amount:       params.amount.toFixed(2),
      ach_class:    (params.achClass ?? 'ppd') as ACHClass,
      user: {
        legal_name: params.legalName,
      },
    });

    const decision = authRes.data.authorization.decision;
    if (decision !== 'approved') {
      const rationale = authRes.data.authorization.decision_rationale;
      throw new Error(
        `Transfer authorization declined: ${rationale?.description ?? decision}`,
      );
    }
    authorizationId = authRes.data.authorization.id;
  } catch (err) {
    logger.error({ err, params: { ...params, accessToken: '[REDACTED]' } }, 'Plaid transferAuthorizationCreate failed');
    throw wrapPlaidError(err, 'Transfer authorization failed');
  }

  // Step 2: create the transfer using the authorization_id
  const request: TransferCreateRequest = {
    access_token:     params.accessToken,
    account_id:       params.accountId,
    authorization_id: authorizationId,
    description:      params.description.slice(0, 15),  // ACH 15-char limit
  };

  try {
    const res = await client.transferCreate(request);
    return {
      transferId: res.data.transfer.id,
      status:     res.data.transfer.status,
    };
  } catch (err) {
    logger.error({ err, params: { ...params, accessToken: '[REDACTED]' } }, 'Plaid transferCreate failed');
    throw wrapPlaidError(err, 'Failed to initiate ACH transfer');
  }
}

/**
 * Get the current status of a Plaid transfer.
 */
export async function getTransferStatus(
  transferId: string,
): Promise<{ status: string; failureReason?: string }> {
  const client = getClient();

  try {
    const res = await client.transferGet({ transfer_id: transferId });
    const t   = res.data.transfer;
    return {
      status:        t.status,
      failureReason: t.failure_reason?.description ?? undefined,
    };
  } catch (err) {
    logger.error({ err, transferId }, 'Plaid transferGet failed');
    throw wrapPlaidError(err, 'Failed to get transfer status');
  }
}

/**
 * Cancel a pending Plaid transfer (only possible while status === 'pending').
 */
export async function cancelTransfer(transferId: string): Promise<void> {
  const client = getClient();

  try {
    await client.transferCancel({ transfer_id: transferId });
  } catch (err) {
    logger.error({ err, transferId }, 'Plaid transferCancel failed');
    throw wrapPlaidError(err, 'Failed to cancel transfer');
  }
}

// ── Error helpers ─────────────────────────────────────────────────────────────

interface PlaidErrorBody {
  response?: {
    data?: {
      error_code?: string;
      error_message?: string;
      display_message?: string;
    };
  };
}

function wrapPlaidError(err: unknown, fallbackMessage: string): Error {
  const plaidErr = err as PlaidErrorBody;
  const data = plaidErr?.response?.data;
  if (data) {
    const msg = data.display_message ?? data.error_message ?? fallbackMessage;
    const wrapped = new Error(`[Plaid ${data.error_code ?? 'ERROR'}] ${msg}`);
    return wrapped;
  }
  if (err instanceof Error) return err;
  return new Error(fallbackMessage);
}
