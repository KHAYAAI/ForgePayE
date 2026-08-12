/**
 * Billing — the bureau's revenue path.
 *
 * Every credit-file pull (`POST /v1/reports`, `POST /v1/lender-reports`) costs
 * INQUIRY_FEE_USD. Before this module the fee was only ever computed and
 * displayed — embedded in every report response and folded into
 * `bureauStats().inquiryRevenueUsd` as a derived `count × fee` — but nothing
 * charged it. No payment SDK existed in this service, and neither
 * billing-engine (the Kill Bill fork) nor mor-layer (the Polar fork) has ever
 * heard of the bureau; both are built for subscriptions and merchant
 * checkout, not a per-call charge from an autonomous agent.
 *
 * This gives every requestor (a lender, a furnisher pulling its own agents'
 * files, or an agent operator pulling on itself) a prepaid USD ledger:
 *
 *   - Top up via the x402 USDC flow that already exists in stablecoin-gateway
 *     — the natural rail here, since the callers are AI agents, not humans at
 *     a checkout page.
 *   - Each pull debits INQUIRY_FEE_USD synchronously, before any credit data
 *     is released, following the same "no trace if refused" rule already
 *     applied to invalid consent in index.ts: a declined charge records no
 *     hard inquiry and — because the caller in index.ts verifies consent
 *     without consuming it until the charge clears — does not burn the
 *     consent token either.
 *
 * Amounts are held as integer USD cents throughout (`balanceUsdCents`,
 * `amountUsdCents`) to keep the ledger free of floating-point drift; USD
 * values only reappear at the API boundary via `centsToUsd`.
 */

import { randomUUID } from 'crypto';
import type { BillingAccount, BillingTransaction, TopUpReceipt } from './types';
import { INQUIRY_FEE_USD } from './grade';
import {
  getBillingAccount, setBillingAccount,
  recordBillingTransaction, listBillingTransactions,
  getTopUpReceipt, setTopUpReceipt,
} from './store';

// ── USD <-> cents ─────────────────────────────────────────────────────────────

export const usdToCents = (usd: number): number => Math.round(usd * 100);
export const centsToUsd = (cents: number): number => +(cents / 100).toFixed(2);

// ── Ledger ────────────────────────────────────────────────────────────────────

function getOrCreateAccount(requestorId: string): BillingAccount {
  const existing = getBillingAccount(requestorId);
  if (existing) return existing;
  const now = new Date().toISOString();
  return setBillingAccount({ requestorId, balanceUsdCents: 0, createdAt: now, updatedAt: now });
}

export function getAccountSummary(requestorId: string): BillingAccount {
  return getOrCreateAccount(requestorId);
}

/**
 * Credit an account — a confirmed top-up, or a manual admin adjustment (wire
 * transfer, invoiced customer, support correction).
 */
export function creditAccount(
  requestorId: string,
  amountUsd: number,
  reason: string,
): { account: BillingAccount; transaction: BillingTransaction } {
  const amountCents = usdToCents(amountUsd);
  if (amountCents <= 0) {
    throw new Error(`creditAccount: amountUsd must be positive, got ${amountUsd}`);
  }

  const account = getOrCreateAccount(requestorId);
  const updated: BillingAccount = {
    ...account,
    balanceUsdCents: account.balanceUsdCents + amountCents,
    updatedAt: new Date().toISOString(),
  };
  setBillingAccount(updated);

  const transaction: BillingTransaction = {
    id: randomUUID(),
    requestorId,
    type: 'credit',
    amountUsdCents: amountCents,
    balanceAfterUsdCents: updated.balanceUsdCents,
    reason,
    createdAt: updated.updatedAt,
  };
  recordBillingTransaction(transaction);

  return { account: updated, transaction };
}

export type DebitResult =
  | { ok: true; account: BillingAccount; transaction: BillingTransaction }
  | { ok: false; reason: 'insufficient_funds'; balanceUsdCents: number; requiredUsdCents: number };

/**
 * Debit an account, or refuse if the balance can't cover it.
 *
 * The check and the write happen with no `await` between them, so within this
 * single process there is no interleaving that could let two concurrent
 * debits both pass the balance check against the same starting balance —
 * Node's event loop cannot preempt a synchronous function. That guarantee is
 * per-process only; a second bureau replica sharing the same Postgres balance
 * would need a real transactional decrement to hold it across processes,
 * exactly like the equivalent single-process caveat already documented on
 * consent.ts's single-use token cache.
 */
export function debitAccount(
  requestorId: string,
  amountUsd: number,
  reason: string,
): DebitResult {
  const amountCents = usdToCents(amountUsd);
  const account = getOrCreateAccount(requestorId);

  if (account.balanceUsdCents < amountCents) {
    return {
      ok: false,
      reason: 'insufficient_funds',
      balanceUsdCents: account.balanceUsdCents,
      requiredUsdCents: amountCents,
    };
  }

  const updated: BillingAccount = {
    ...account,
    balanceUsdCents: account.balanceUsdCents - amountCents,
    updatedAt: new Date().toISOString(),
  };
  setBillingAccount(updated);

  const transaction: BillingTransaction = {
    id: randomUUID(),
    requestorId,
    type: 'debit',
    amountUsdCents: amountCents,
    balanceAfterUsdCents: updated.balanceUsdCents,
    reason,
    createdAt: updated.updatedAt,
  };
  recordBillingTransaction(transaction);

  return { ok: true, account: updated, transaction };
}

/** The one fee this bureau currently charges: a credit-file pull. */
export function chargeInquiryFee(requestorId: string, reason: string): DebitResult {
  return debitAccount(requestorId, INQUIRY_FEE_USD, reason);
}

export function billingHistory(requestorId: string): BillingTransaction[] {
  return listBillingTransactions(requestorId);
}

// ── x402 top-up (stablecoin-gateway) ─────────────────────────────────────────
//
// Same fail-closed convention as sanctions.ts's compliance-monitor client:
// STABLECOIN_GATEWAY_URL unset means top-ups are simply unavailable (503),
// never silently skipped — unlike a sanctions check, there is no "pass
// anyway" reading of a missing payment rail.

function gatewayUrl(): string | undefined {
  return process.env['STABLECOIN_GATEWAY_URL'];
}

/**
 * The bureau's own identity as an x402 merchant. stablecoin-gateway's
 * `/x402/pay` groups payment intents by `merchant_id`; this is that id for
 * every top-up the bureau opens, distinguishing bureau top-ups from any other
 * merchant using the same shared gateway.
 */
const BUREAU_MERCHANT_ID = process.env['BUREAU_X402_MERCHANT_ID'] ?? 'forgepay-credit-bureau';

interface X402PayResponse {
  receipt_id: string;
  deposit_id: string;
  amount_usdc: number;
  amount_units: string;
  chain: string;
  token: string;
  expires_at: string;
  status: string;
}

interface X402VerifyResponse {
  status: string;
  valid: boolean;
}

export type TopUpOutcome =
  | {
      ok: true;
      receipt: TopUpReceipt;
      gateway: {
        receiptId: string;
        depositId: string;
        amountUnits: string;
        chain: string;
        token: string;
        expiresAt: string;
      };
    }
  | { ok: false; reason: 'not_configured' | 'call_failed' | 'amount_invalid'; message: string };

/**
 * Open a top-up: ask stablecoin-gateway to create an x402 payment intent for
 * `amountUsd`, addressed to the bureau's own merchant id, and track it
 * locally so a later `confirmTopUp` can be checked for replay.
 *
 * This only opens the ledger-side intent. The caller still has to actually
 * broadcast USDC — the vault address and asset details live at
 * `GET {STABLECOIN_GATEWAY_URL}/x402/payment-required`, which this
 * deliberately does not re-fetch and re-embed on every top-up: that address
 * is a gateway-wide constant, not something scoped per payment intent, so a
 * caller resolves it once rather than the bureau proxying it on every call.
 */
export async function requestTopUp(requestorId: string, amountUsd: number): Promise<TopUpOutcome> {
  const base = gatewayUrl();
  if (!base) {
    return { ok: false, reason: 'not_configured', message: 'STABLECOIN_GATEWAY_URL is not set — top-ups are unavailable.' };
  }
  if (!(amountUsd > 0)) {
    return { ok: false, reason: 'amount_invalid', message: 'amountUsd must be positive.' };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/x402/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resource_url: `bureau:topup:${requestorId}`,
        amount_usdc:  amountUsd,
        merchant_id:  BUREAU_MERCHANT_ID,
        agent_id:     requestorId,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, reason: 'call_failed', message: `stablecoin-gateway /x402/pay returned ${res.status}: ${body}` };
    }

    const gateway = (await res.json()) as X402PayResponse;
    const receipt: TopUpReceipt = {
      receiptId:  gateway.receipt_id,
      requestorId,
      amountUsd,
      status:     'pending',
      createdAt:  new Date().toISOString(),
    };
    setTopUpReceipt(receipt);

    return {
      ok: true,
      receipt,
      gateway: {
        receiptId:   gateway.receipt_id,
        depositId:   gateway.deposit_id,
        amountUnits: gateway.amount_units,
        chain:       gateway.chain,
        token:       gateway.token,
        expiresAt:   gateway.expires_at,
      },
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'call_failed',
      message: `stablecoin-gateway /x402/pay call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type ConfirmOutcome =
  | { ok: true; alreadyConfirmed: boolean; account: BillingAccount }
  | {
      ok: false;
      reason: 'not_found' | 'requestor_mismatch' | 'not_configured' | 'not_yet_paid' | 'call_failed';
      message: string;
    };

/**
 * Confirm a top-up: check stablecoin-gateway for on-chain confirmation and,
 * if confirmed, credit the ledger exactly once.
 *
 * Safe to call repeatedly. `receipt.status` gates the credit — a retried
 * confirm (client timeout and retry, a double-click) returns the same
 * already-credited result rather than crediting the same on-chain payment
 * twice.
 */
export async function confirmTopUp(receiptId: string, requestorId: string): Promise<ConfirmOutcome> {
  const receipt = getTopUpReceipt(receiptId);
  if (!receipt) {
    return { ok: false, reason: 'not_found', message: `No top-up with receipt ${receiptId}.` };
  }
  if (receipt.requestorId !== requestorId) {
    return { ok: false, reason: 'requestor_mismatch', message: 'This top-up belongs to a different requestor.' };
  }
  if (receipt.status === 'confirmed') {
    return { ok: true, alreadyConfirmed: true, account: getOrCreateAccount(requestorId) };
  }

  const base = gatewayUrl();
  if (!base) {
    return { ok: false, reason: 'not_configured', message: 'STABLECOIN_GATEWAY_URL is not set — cannot verify top-ups.' };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/x402/verify/${receiptId}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, reason: 'call_failed', message: `stablecoin-gateway /x402/verify returned ${res.status}.` };
    }
    const verification = (await res.json()) as X402VerifyResponse;
    if (!verification.valid) {
      return { ok: false, reason: 'not_yet_paid', message: `Payment not yet confirmed on-chain (status: ${verification.status}).` };
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'call_failed',
      message: `stablecoin-gateway /x402/verify call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Marked confirmed before crediting: if the process crashed between these
  // two writes, restart would see status 'confirmed' with no matching ledger
  // entry rather than risk a second credit on retry. That gap is a manual
  // reconciliation case (compare billing_topups against billing_transactions
  // for `topup:x402:<receiptId>`), not a silent double-credit.
  setTopUpReceipt({ ...receipt, status: 'confirmed', confirmedAt: new Date().toISOString() });
  const { account } = creditAccount(requestorId, receipt.amountUsd, `topup:x402:${receiptId}`);

  return { ok: true, alreadyConfirmed: false, account };
}
