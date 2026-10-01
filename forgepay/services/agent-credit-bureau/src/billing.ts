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
import type { BillingAccount, BillingTransaction, TopUpReceipt, Subscription, PlanId, PaymentAsset } from './types';
import { PAYMENT_ASSETS } from './types';
import { INQUIRY_FEE_USD } from './grade';
import { entitlementForNextPull, periodHasLapsed, DEFAULT_PLAN_ID } from './plans';
import {
  getBillingAccount, setBillingAccount,
  recordBillingTransaction, listBillingTransactions,
  getTopUpReceipt, setTopUpReceipt,
  getSubscription, setSubscription,
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

// ── Entitlement-aware charging ────────────────────────────────────────────────

export type PullCharge =
  | { ok: true; kind: 'bundled'; bundledRemaining: number }
  | { ok: true; kind: 'paid'; priceUsd: number; transaction: BillingTransaction; balanceUsdCents: number }
  | { ok: false; reason: 'plan_forbids_hard_pulls'; planId: PlanId }
  | { ok: false; reason: 'insufficient_funds'; priceUsd: number; balanceUsdCents: number };

/**
 * Charge for one hard pull against the requestor's plan, then their balance.
 *
 * Replaces a flat `chargeInquiryFee` that debited $2.80 regardless of what the
 * caller had already paid for. Two things were wrong with that: a subscriber
 * who had bought 2,500 bundled inquiries was charged again for every one of
 * them, and volume pricing existed nowhere, so the published discount bands
 * were unreachable.
 *
 * Order matters. Bundled allocation is spent before cash, because the
 * alternative bills someone twice for the same entitlement. A requestor with no
 * subscription falls to the Observer plan, which forbids hard pulls outright —
 * failing closed rather than silently granting institutional entitlement to an
 * unsubscribed caller.
 */
export function chargeForPull(requestorId: string, reason: string, now = new Date()): PullCharge {
  let sub = getSubscription(requestorId);

  // Roll the entitlement year over before reading it, so a subscriber does not
  // stay exhausted into a period they have already paid for.
  if (sub && periodHasLapsed(sub, now)) {
    sub = setSubscription({
      ...sub,
      periodStartedAt: now.toISOString(),
      pullsUsedThisPeriod: 0,
      updatedAt: now.toISOString(),
    });
  }

  const entitlement = entitlementForNextPull(sub);

  if (entitlement.kind === 'refused') {
    return { ok: false, reason: 'plan_forbids_hard_pulls', planId: sub?.planId ?? DEFAULT_PLAN_ID };
  }

  if (entitlement.kind === 'bundled') {
    // No cash moves. The pull is already paid for by the subscription.
    setSubscription({
      ...sub!,
      pullsUsedThisPeriod: sub!.pullsUsedThisPeriod + 1,
      updatedAt: now.toISOString(),
    });
    return { ok: true, kind: 'bundled', bundledRemaining: entitlement.remainingAfter };
  }

  const debit = debitAccount(requestorId, entitlement.priceUsd, reason);
  if (!debit.ok) {
    return {
      ok: false,
      reason: 'insufficient_funds',
      priceUsd: entitlement.priceUsd,
      balanceUsdCents: debit.balanceUsdCents,
    };
  }

  // Counted even though it was paid in cash: the counter is what advances the
  // volume band, so a subscriber's price steps down as their annual volume
  // grows rather than resetting on every call.
  if (sub) {
    setSubscription({
      ...sub,
      pullsUsedThisPeriod: sub.pullsUsedThisPeriod + 1,
      updatedAt: now.toISOString(),
    });
  }

  return {
    ok: true,
    kind: 'paid',
    priceUsd: entitlement.priceUsd,
    transaction: debit.transaction,
    balanceUsdCents: debit.account.balanceUsdCents,
  };
}

/** Assign or change a requestor's plan. Admin-only at the route layer. */
export function setPlan(requestorId: string, planId: PlanId, now = new Date()): Subscription {
  const existing = getSubscription(requestorId);
  if (existing) {
    return setSubscription({ ...existing, planId, status: 'active', updatedAt: now.toISOString() });
  }
  return setSubscription({
    requestorId,
    planId,
    periodStartedAt: now.toISOString(),
    pullsUsedThisPeriod: 0,
    status: 'active',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });
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
  pay_to?: string;
  asset?: { symbol: string; chain: string; contract: string; decimals: number; unit?: string };
  amount_usd?: number;
  amount_asset?: string;
  amount_units: string;
  fx?: { pair: string; rate: string; as_of: string; source: string };
  chain: string;
  token?: string;
  expires_at: string;
  status: string;
}

interface X402VerifyResponse {
  status: string;
  valid: boolean;
  asset?: string;
  received_units?: string | null;
  amount_units?: string;
}

/**
 * The asset a top-up is paid in when the caller doesn't say. USDC unless the
 * operator sets BUREAU_DEFAULT_ASSET to ZARP or OUSD.
 */
export function defaultAsset(): PaymentAsset {
  const v = (process.env['BUREAU_DEFAULT_ASSET'] ?? 'USDC').toUpperCase();
  return (PAYMENT_ASSETS as readonly string[]).includes(v) ? (v as PaymentAsset) : 'USDC';
}

/** Chain top-ups are paid on. */
const TOPUP_CHAIN = process.env['BUREAU_TOPUP_CHAIN'] ?? 'base';

/**
 * Every call to stablecoin-gateway must carry a key: its auth plugin rejects a
 * request with none before anything else. (furnisher-payouts.ts does the same.)
 */
function gatewayAuthHeaders(): Record<string, string> {
  const key = process.env['STABLECOIN_GATEWAY_API_KEY'];
  return key ? { 'x-api-key': key } : {};
}

export type TopUpOutcome =
  | {
      ok: true;
      receipt: TopUpReceipt;
      gateway: {
        receiptId: string;
        depositId: string;
        /** Send to this address. */
        payTo?: string;
        asset: string;
        contract?: string;
        decimals?: number;
        /** Whole tokens to send, and the exact smallest units. */
        amountAsset?: string;
        amountUnits: string;
        /** For ZARP: the locked ZAR-per-USD rate. */
        fxRate?: string;
        chain: string;
        token: string;
        expiresAt: string;
      };
    }
  | { ok: false; reason: 'not_configured' | 'call_failed' | 'amount_invalid' | 'asset_unavailable'; message: string };

/**
 * Open a top-up: ask stablecoin-gateway to quote `amountUsd` in `asset` (USDC,
 * ZARP or OUSD) and open a payment for it, addressed to the bureau's own
 * merchant id, and track it locally so a later `confirmTopUp` can be checked
 * for replay.
 *
 * The ledger is USD. A ZARP top-up is priced in rand at the rate the gateway
 * locks when it is opened, but what is credited on confirmation is exactly the
 * USD value requested here.
 *
 * This only opens the intent. The response names the one-time address and the
 * exact amount of that token to send; the payer still has to send it.
 */
export async function requestTopUp(
  requestorId: string, amountUsd: number, asset: PaymentAsset = defaultAsset(),
): Promise<TopUpOutcome> {
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
      headers: { 'content-type': 'application/json', ...gatewayAuthHeaders() },
      body: JSON.stringify({
        resource_url: `bureau:topup:${requestorId}`,
        amount_usd:   amountUsd,
        // Older gateways only understand this name, and only for USDC. It is not sent for
        // other assets: an old gateway would ignore `asset` and quote USDC instead.
        ...(asset === 'USDC' ? { amount_usdc: amountUsd } : {}),
        asset,
        chain:        TOPUP_CHAIN,
        merchant_id:  BUREAU_MERCHANT_ID,
        agent_id:     requestorId,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // The gateway says 503 when an asset can't be quoted right now (unverified token, no rand rate).
      return {
        ok: false,
        reason: res.status === 503 ? 'asset_unavailable' : 'call_failed',
        message: res.status === 503
          ? `${asset} is not available for top-ups right now: ${extractMessage(body)}`
          : `stablecoin-gateway /x402/pay returned ${res.status}: ${body}`,
      };
    }

    const gateway = (await res.json()) as X402PayResponse;
    const paidIn = (gateway.asset?.symbol ?? gateway.token ?? 'USDC').toUpperCase();
    // An old gateway ignores `asset` and answers in USDC. Accepting that would credit a
    // payment the requestor believes is in another token — refuse it.
    if (paidIn !== asset) {
      return { ok: false, reason: 'asset_unavailable', message: `Asked for a ${asset} top-up but the gateway quoted ${paidIn}; it may not support ${asset}.` };
    }

    const receipt: TopUpReceipt = {
      receiptId:  gateway.receipt_id,
      requestorId,
      amountUsd,
      status:     'pending',
      createdAt:  new Date().toISOString(),
      asset,
      chain:      gateway.asset?.chain ?? gateway.chain,
      assetUnits: gateway.amount_units,
      ...(gateway.amount_asset ? { assetAmount: gateway.amount_asset } : {}),
      ...(gateway.asset?.decimals !== undefined ? { decimals: gateway.asset.decimals } : {}),
      ...(gateway.fx && gateway.asset?.unit === 'ZAR' ? { fxRate: gateway.fx.rate, fxPair: gateway.fx.pair } : {}),
      ...(gateway.pay_to ? { payTo: gateway.pay_to } : {}),
      ...(gateway.asset?.contract ? { contract: gateway.asset.contract } : {}),
    };
    setTopUpReceipt(receipt);

    return {
      ok: true,
      receipt,
      gateway: {
        receiptId:   gateway.receipt_id,
        depositId:   gateway.deposit_id,
        ...(gateway.pay_to ? { payTo: gateway.pay_to } : {}),
        asset,
        ...(gateway.asset?.contract ? { contract: gateway.asset.contract } : {}),
        ...(gateway.asset?.decimals !== undefined ? { decimals: gateway.asset.decimals } : {}),
        ...(gateway.amount_asset ? { amountAsset: gateway.amount_asset } : {}),
        amountUnits: gateway.amount_units,
        ...(receipt.fxRate ? { fxRate: receipt.fxRate } : {}),
        chain:       receipt.chain ?? gateway.chain,
        token:       paidIn,
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

function extractMessage(body: string): string {
  try { const j = JSON.parse(body) as { message?: string; error?: string }; return j.message ?? j.error ?? body; } catch { return body; }
}

export type ConfirmOutcome =
  | { ok: true; alreadyConfirmed: boolean; account: BillingAccount }
  | {
      ok: false;
      reason: 'not_found' | 'requestor_mismatch' | 'not_configured' | 'not_yet_paid' | 'call_failed' | 'amount_mismatch';
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
      headers: gatewayAuthHeaders(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { ok: false, reason: 'call_failed', message: `stablecoin-gateway /x402/verify returned ${res.status}.` };
    }
    const verification = (await res.json()) as X402VerifyResponse;
    if (!verification.valid) {
      return { ok: false, reason: 'not_yet_paid', message: `Payment not yet confirmed on-chain (status: ${verification.status}).` };
    }
    // Belt and braces: the gateway says it is paid; check it is paid in the token and
    // amount this receipt asked for before crediting dollars for it.
    if (receipt.asset && verification.asset && verification.asset.toUpperCase() !== receipt.asset) {
      return { ok: false, reason: 'amount_mismatch', message: `Receipt is for ${receipt.asset} but the gateway confirmed a ${verification.asset} payment.` };
    }
    if (receipt.assetUnits && verification.received_units) {
      let short = false;
      try { short = BigInt(verification.received_units) < BigInt(receipt.assetUnits); } catch { short = true; }
      if (short) {
        return { ok: false, reason: 'amount_mismatch', message: `Gateway confirmed ${verification.received_units} units but this top-up needs ${receipt.assetUnits}.` };
      }
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'call_failed',
      message: `stablecoin-gateway /x402/verify call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // The gateway call above yielded the event loop, so another confirm for this same receipt may have
  // finished (and credited) while we waited. Re-read it now, with no await between this check and the
  // write below, so exactly one concurrent caller credits.
  const current = getTopUpReceipt(receiptId);
  if (!current) {
    return { ok: false, reason: 'not_found', message: `No top-up with receipt ${receiptId}.` };
  }
  if (current.status === 'confirmed') {
    return { ok: true, alreadyConfirmed: true, account: getOrCreateAccount(requestorId) };
  }

  // Marked confirmed before crediting: if the process crashed between these
  // two writes, restart would see status 'confirmed' with no matching ledger
  // entry rather than risk a second credit on retry. That gap is a manual
  // reconciliation case (compare billing_topups against billing_transactions
  // for `topup:x402:<receiptId>`), not a silent double-credit.
  setTopUpReceipt({ ...current, status: 'confirmed', confirmedAt: new Date().toISOString() });
  const { account } = creditAccount(requestorId, receipt.amountUsd, `topup:x402:${receiptId}`);

  return { ok: true, alreadyConfirmed: false, account };
}
