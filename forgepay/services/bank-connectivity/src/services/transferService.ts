/**
 * Transfer service — business logic for ACH, wire, and SEPA transfers.
 *
 * Storage: Prisma + PostgreSQL (Transfer / InternalTransfer tables).
 *
 * Idempotency:
 *   The caller may supply a unique `idempotencyKey` per TransferRequest.
 *   If a transfer with the same key already exists the existing record is
 *   returned without creating a duplicate (enforced by DB UNIQUE constraint).
 */

import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import type { Transfer, TransferRequest } from '../types';
import * as plaid from '../plaid/client';
import { getOpenBankingClient } from '../openbanking/client';
import * as accountService from './accountService';
import { logger } from '../lib/logger';

const prisma = new PrismaClient();

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a Prisma Transfer row to the domain Transfer type. */
function rowToTransfer(row: {
  id: string;
  merchantId: string;
  accountId: string;
  type: string;
  direction: string;
  amountCents: bigint;
  currency: string;
  description: string | null;
  status: string;
  idempotencyKey: string | null;
  externalRef: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}, fromAccountId: string, toAccountId: string): Transfer {
  return {
    id:                row.id,
    merchantId:        row.merchantId,
    fromAccountId,
    toAccountId,
    // Convert cents (BigInt) back to decimal major units
    amount:            Number(row.amountCents) / 100,
    currency:          row.currency,
    type:              row.type as Transfer['type'],
    status:            row.status as Transfer['status'],
    description:       row.description ?? '',
    idempotencyKey:    row.idempotencyKey ?? undefined,
    providerTransferId: row.externalRef ?? undefined,
    failureReason:     row.failureReason ?? undefined,
    createdAt:         row.createdAt.toISOString(),
    updatedAt:         row.updatedAt.toISOString(),
  };
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
    const existing = await prisma.transfer.findUnique({
      where: { idempotencyKey: req.idempotencyKey },
    });
    if (existing && existing.merchantId === merchantId) {
      logger.info(
        { transferId: existing.id, idempotencyKey: req.idempotencyKey },
        'Idempotent transfer — returning existing record',
      );
      return rowToTransfer(existing, req.fromAccountId, req.toAccountId);
    }
  }

  // ── 2. Validate accounts ──────────────────────────────────────────────────
  const fromAccount = await accountService.getAccount(req.fromAccountId, merchantId);
  const toAccount   = await accountService.getAccount(req.toAccountId,   merchantId);

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

    const accessToken = await accountService.getAccessToken(req.fromAccountId);
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

    const consentId = await accountService.getConsentId(req.fromAccountId);
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
  const transferId  = uuidv4();
  // Store amount as cents (BigInt) — multiply by 100 and round to avoid float issues
  const amountCents = BigInt(Math.round(req.amount * 100));

  const row = await prisma.transfer.create({
    data: {
      id:             transferId,
      merchantId,
      accountId:      req.fromAccountId,
      type:           req.type,
      direction:      'debit',
      amountCents,
      currency:       req.currency,
      description:    req.description,
      status:         'pending',
      idempotencyKey: req.idempotencyKey ?? null,
      externalRef:    providerTransferId ?? null,
    },
  });

  const transfer = rowToTransfer(row, req.fromAccountId, req.toAccountId);
  logger.info({ transferId, merchantId, type: req.type, amount: req.amount }, 'Transfer created');
  return transfer;
}

/**
 * Return a paginated list of transfers for a merchant.
 * Supports optional filters: status and date range.
 */
export async function listTransfers(opts: TransferListOptions): Promise<{
  transfers: Transfer[];
  total:     number;
  page:      number;
  perPage:   number;
  hasMore:   boolean;
}> {
  const page    = Math.max(1, opts.page    ?? 1);
  const perPage = Math.min(100, Math.max(1, opts.perPage ?? 20));
  const skip    = (page - 1) * perPage;

  const where: Record<string, unknown> = { merchantId: opts.merchantId };
  if (opts.status)   where['status']    = opts.status;
  if (opts.fromDate) where['createdAt'] = { ...(where['createdAt'] as object ?? {}), gte: new Date(opts.fromDate) };
  if (opts.toDate)   where['createdAt'] = { ...(where['createdAt'] as object ?? {}), lte: new Date(opts.toDate) };

  const [rows, total] = await Promise.all([
    prisma.transfer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take:    perPage,
    }),
    prisma.transfer.count({ where }),
  ]);

  // accountId in the Transfer row is fromAccountId; toAccountId not stored separately
  const transfers = rows.map((r) => rowToTransfer(r, r.accountId, r.accountId));

  return {
    transfers,
    total,
    page,
    perPage,
    hasMore: skip + perPage < total,
  };
}

/**
 * Return a single transfer by ID, scoped to the merchant.
 */
export async function getTransfer(transferId: string, merchantId: string): Promise<Transfer> {
  const row = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!row || row.merchantId !== merchantId) {
    const err = new Error(`Transfer not found: ${transferId}`);
    (err as NodeJS.ErrnoException).code = 'NOT_FOUND';
    throw err;
  }
  return rowToTransfer(row, row.accountId, row.accountId);
}

/**
 * Update transfer status — called by webhook handlers when the provider
 * reports a status change.
 */
export async function pollTransferStatus(
  transferId:    string,
  newStatus:     Transfer['status'],
  failureReason?: string,
): Promise<Transfer> {
  const existing = await prisma.transfer.findUnique({ where: { id: transferId } });
  if (!existing) {
    throw new Error(`Transfer not found: ${transferId}`);
  }

  const row = await prisma.transfer.update({
    where: { id: transferId },
    data: {
      status:        newStatus,
      failureReason: failureReason ?? existing.failureReason ?? null,
    },
  });

  logger.info({ transferId, newStatus, failureReason }, 'Transfer status updated');
  return rowToTransfer(row, row.accountId, row.accountId);
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
  const transfer = await getTransfer(transferId, merchantId);

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

  const row = await prisma.transfer.update({
    where: { id: transferId },
    data:  { status: 'cancelled' },
  });

  logger.info({ transferId, merchantId }, 'Transfer cancelled');
  return rowToTransfer(row, row.accountId, row.accountId);
}
