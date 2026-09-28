/**
 * stablecoin-gateway client — outbound x402 calls for the checkout's USDC
 * payment method.
 *
 * Same contract agent-credit-bureau/src/billing.ts already uses for its own
 * top-ups (POST /x402/pay, GET /x402/verify/:id) — reused verbatim rather
 * than inventing a second integration shape against the same gateway. Same
 * fail-closed convention too: STABLECOIN_GATEWAY_URL unset means "USDC
 * checkout unavailable", not silently skipped.
 */

import { config } from '../config.js';
import { logger } from './logger.js';

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

export type RequestX402PaymentResult =
  | {
      ok: true;
      receiptId: string;
      depositId: string;
      amountUnits: string;
      chain: string;
      token: string;
      expiresAt: string;
    }
  | { ok: false; reason: 'not_configured' | 'call_failed' | 'amount_invalid'; message: string };

export async function requestX402Payment(
  sessionId: string,
  amountUsd: number,
): Promise<RequestX402PaymentResult> {
  const base = config.stablecoinGateway.baseUrl;
  if (!base) {
    return { ok: false, reason: 'not_configured', message: 'STABLECOIN_GATEWAY_URL is not set — USDC checkout is unavailable.' };
  }
  if (!(amountUsd > 0)) {
    return { ok: false, reason: 'amount_invalid', message: 'amountUsd must be positive.' };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/x402/pay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        resource_url: `checkout:session:${sessionId}`,
        amount_usdc:  amountUsd,
        merchant_id:  config.stablecoinGateway.merchantId,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.error({ status: res.status, body, sessionId }, '[stablecoin-gateway] x402/pay failed');
      return { ok: false, reason: 'call_failed', message: `stablecoin-gateway /x402/pay returned ${res.status}: ${body}` };
    }

    const gw = (await res.json()) as X402PayResponse;
    return {
      ok: true,
      receiptId:   gw.receipt_id,
      depositId:   gw.deposit_id,
      amountUnits: gw.amount_units,
      chain:       gw.chain,
      token:       gw.token,
      expiresAt:   gw.expires_at,
    };
  } catch (err) {
    return {
      ok: false,
      reason: 'call_failed',
      message: `stablecoin-gateway /x402/pay call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export type VerifyX402PaymentResult =
  | { ok: true; valid: boolean; status: string }
  | { ok: false; reason: 'not_configured' | 'call_failed'; message: string };

export async function verifyX402Payment(receiptId: string): Promise<VerifyX402PaymentResult> {
  const base = config.stablecoinGateway.baseUrl;
  if (!base) {
    return { ok: false, reason: 'not_configured', message: 'STABLECOIN_GATEWAY_URL is not set.' };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/x402/verify/${receiptId}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      return { ok: false, reason: 'call_failed', message: `stablecoin-gateway /x402/verify returned ${res.status}.` };
    }
    const data = (await res.json()) as { status: string; valid: boolean };
    return { ok: true, valid: data.valid, status: data.status };
  } catch (err) {
    return {
      ok: false,
      reason: 'call_failed',
      message: `stablecoin-gateway /x402/verify call failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
