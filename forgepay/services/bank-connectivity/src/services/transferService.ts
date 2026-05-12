/**
 * Transfer service — business logic for ACH, wire, and SEPA transfers.
 *
 * Storage strategy:
 *   In-memory Map for development (same pattern as accountService).
 *   In production, replace Map operations with Prisma calls to the
 *   `transfers` PostgreSQL table.  The public function signatures are stable.
 *
 * Idempotency:
 *   The caller may supply a unique `idempotencyKey` per TransferRequest.
 *   If a transfer with the same key already exists for the same merchant,
 *   the existing transfer is returned without creating a duplicate.
 *   The key is stored and checked in the `idempotencyIndex` Map.
 */

import { v4 as uuidv4 } from 'uuid';
import type { Transfer, TransferRequest } from '../types';
import * as plaid from '../plaid/client';
import { getOpenBankingClient } from '../openbanking/client';
import * as accountService from './accountService';
import { logger } from '../lib/logger';

// ── In-memory stores (replace with Prisma + PostgreSQL in production) ─────────

const transfers        = new Map<string, Transfer>();
const merchantTxIndex  = new Map<string, Set<string>>();  // merchantId → Set<transferId>
const idempotencyIndex = new Map<string, string>();        // `${merchantId}:${key}` → transferId

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function indexTransfer(merchantId: string, transferId: string): void {
  const existing = merchantTxIndex.get(merchantId) ?? new Set<string>();
  existing.add(transferId);
  merchantTxIndex.set(merchantId, existing);
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface TransferListOptions {
  merchantId: string;
  status?:    Transfer['status'];
  fromDate?:  string;   // ISO-8601
  toDate?:    string;   // ISO-8601
  page?:      number;
  perPage?:   number;
}

/**
 * Initiate an ACH, wire, or SEPA transfer.
 *
 * Steps:
 *   1. Idempotency check — return existing transfer if key already used.
 *   2. Validate that both accounts belong to this merchant.
 *   3. Check sufficient available balance on the source account.
 *   4. Route to the appropriate provider (Plaid for ACH, OB for SEPA).
 *   5. Persist the transfer record.
 */
export async function initiateTransfer(
  merchantId: string,
  req:        TransferRequest,
): Promise<Transfer> {
  // ── 1. Idempotency check ──────────────────────────────────────────────────
  if (req.idempotencyKey) {
    const idxKey     = `${merchantId}:${req.idempotencyKey}`;
    const existingId = idempotencyIndex.get(idxKey);
    if (existingId) {
      const existing = transfers.get(existingId);
      if (existing) {
        logger.info(
          { transferId: existingId, idempotencyKey: req.idempotencyKey },
          'Idempotent transfer — returning existing record',
        );
        return existing;
      }
    }
  }

  // ── 2. Validate accounts ──────────────────────────────────────────────────
  const fromAccount = accountService.getAccount(req.fromAccountId, merchantId);
  const toAccount   = accountService.getAccount(req.toAccountId,   merchantId);

  if (fromAccount.status !== 'active') {
    throw Object.assign(
      new Error(`Source account ${req.fromAccountId} is not active`),
      { code: 'ACCOUNT_NOT_ACTIVE' },
    );
  }

  // ── 3. Balance check ──────────────────────────────────────────────────────
  const availableBalance = fromAccount.balanceAvailable ?? fromAccount.balanceCurrent;
  if (availableBalance !== undefined && availableBalance < req.amount) {
    throw Object.assign(
      new Error(
        `Insufficient available balance: need ${req.amount} ${req.currency}, ` +
        `have ${availableBalance} ${fromAccount.currency}`,
      ),
      { code: 'INSUFFICIENT_FUNDS' },
    );
  }

  // ── 4. Route to provider ──────────────────────────────────────────────────
  let providerTransferId: string | undefined;

  if (req.type === 'ach') {
    if (fromAccount.provider !== 'plaid') {
      throw new Error('ACH transfers require a Plaid-linked account');
    }

    const accessToken = accountService.getAccessToken(req.fromAccountId);
    const result = await plaid.initiateAchTransfer({
      accessToken,
      accountId:      fromAccount.plaidAccountId!,
      amount:         req.amount,
      description:    req.description,
      legalName:      merchantId,  // production: fetch merchant legal name from DB
      idempotencyKey: req.idempotencyKey ?? uuidv4(),
    });

    providerTransferId = result.transferId;
    logger.info(
      { plaidTransferId: result.transferId, status: result.status },
      'Plaid ACH transfer initiated',
    );
  } else if (req.type === 'sepa') {
    if (fromAccount.provider !== 'open_banking') {
      throw new Error('SEPA transfers require an Open Banking account');
    }

    const consentId = accountService.getConsentId(req.fromAccountId);
    const obClient  = getOpenBankingClient();
    const result    = await obClient.initiatePayment({
      fromAccountId: fromAccount.obAccountId!,
      toAccountId:   toAccount.obAccountId ?? req.toAccountId,
      amount:        req.amount,
      currency:      req.currency,
      reference:     req.description,
      consentId,
    });

    providerTransferId = result.paymentId;
    logger.info(
      { paymentId: result.paymentId, status: result.status },
      'Open Banking SEPA payment initiated',
    );
  } else if (req.type === 'wire') {
    // Wire transfers are handled out-of-band (via bank API or SWIFT) in production.
    // For now we create the record as pending and rely on webhook updates.
    logger.info({ fromAccountId: req.fromAccountId }, 'Wire transfer queued');
  }

  // ── 5. Persist ────────────────────────────────────────────────────────────
  const transferId = uuidv4();
  const ts         = now();

  const transfer: Transfer = {
    id:               transferId,
    merchantId,
    fromAccountId:    req.fromAccountId,
    toAccountId:      req.toAccountId,
    amount:           req.amount,
    currency:         req.currency,
    type:             req.type,
    status:           'pending',
    description:      req.description,
    scheduledDate:    req.scheduledDate,
    idempotencyKey:   req.idempotencyKey,
    providerTransferId,
    createdAt:        ts,
    updatedAt:        ts,
  };

  transfers.set(transferId, transfer);
  indexTransfer(merchantId, transferId);

  if (req.idempotencyKey) {
    idempotencyIndex.set(`${merchantId}:${req.idempotencyKey}`, transferId);
  }

  logger.info({ transferId, merchantId, type: req.type, amount: req.amount }, 'Transfer created');
  return transfer;
}

/**
 * Return a paginated list of transfers for a merchant.
 * Supports optional filters: status and date range.
 */
export function listTransfers(opts: TransferListOptions): {
  transfers: Transfer[];
  total:     number;
  page:      number;
  perPage:   number;
  hasMore:   boolean;
} {
  const ids = merchantTxIndex.get(opts.merchantId);
  if (!ids || ids.size === 0) {
    return { transfers: [], total: 0, page: 1, perPage: opts.perPage ?? 20, hasMore: false };
  }

  let results = Array.from(ids)
    .map((id) => transfers.get(id))
    .filter((t): t is Transfer => t !== undefined);

  if (opts.status) {
    results = results.filter((t) => t.status === opts.status);
  }
  if (opts.fromDate) {
    results = results.filter((t) => t.createdAt >= opts.fromDate!);
  }
  if (opts.toDate) {
    results = results.filter((t) => t.createdAt <= opts.toDate!);
  }

  results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const total   = results.length;
  const page    = Math.max(1, opts.page    ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const start   = (page - 1) * perPage;
  const sliced  = results.slice(start, start + perPage);

  return {
    transfers: sliced,
    total,
    page,
    perPage,
    hasMore: start + perPage < total,
  };
}

/**
 * Return a single transfer by ID, scoped to the merchant.
 */
export function getTransfer(transferId: string, merchantId: string): Transfer {
  const transfer = transfers.get(transferId);
  if (!transfer || transfer.merchantId !== merchantId) {
    const err = new Error(`Transfer not found: ${transferId}`);
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }
  return transfer;
}

/**
 * Update transfer status — called by webhook handlers when the provider
 * reports a status change.
 */
export function pollTransferStatus(transferId: string, newStatus: Transfer['status'], failureReason?: string): Transfer {
  const transfer = transfers.get(transferId);
  if (!transfer) {
    throw new Error(`Transfer not found: ${transferId}`);
  }

  const ts      = now();
  const updated: Transfer = {
    ...transfer,
    status:        newStatus,
    failureReason: failureReason ?? transfer.failureReason,
    settledAt:     newStatus === 'completed' ? ts : transfer.settledAt,
    updatedAt:     ts,
  };
  transfers.set(transferId, updated);

  logger.info(
    { transferId, newStatus, failureReason },
    'Transfer status updated',
  );
  return updated;
}

/**
 * Cancel a pending transfer.
 * Only possible while status === 'pending'.  Forwards the cancellation to
 * the provider if a providerTransferId is set.
 */
export async function cancelTransfer(
  transferId: string,
  merchantId: string,
): Promise<Transfer> {
  const transfer = getTransfer(transferId, merchantId);

  if (transfer.status !== 'pending') {
    throw Object.assign(
      new Error(
        `Cannot cancel transfer in status "${transfer.status}" — only pending transfers can be cancelled`,
      ),
      { code: 'INVALID_STATE' },
    );
  }

  // Best-effort provider cancellation
  if (transfer.providerTransferId && transfer.type === 'ach') {
    try {
      await plaid.cancelTransfer(transfer.providerTransferId);
    } catch (err) {
      logger.error(
        { err, transferId, providerTransferId: transfer.providerTransferId },
        'Plaid transfer cancel failed — marking locally anyway',
      );
    }
  }

  const ts      = now();
  const updated: Transfer = {
    ...transfer,
    status:    'cancelled',
    updatedAt: ts,
  };
  transfers.set(transferId, updated);

  logger.info({ transferId, merchantId }, 'Transfer cancelled');
  return updated;
}
