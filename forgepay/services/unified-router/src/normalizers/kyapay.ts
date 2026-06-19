/**
 * KYAPay → ForgePayEvent normalizer.
 *
 * Maps an agent-initiated payment (from a KYAPay JWT + request body) into the
 * canonical ForgePayEvent schema so it enters the standard 5-step pipeline.
 *
 * Settlement asset routing:
 *   sps=USDC / sps=USDT → source='stablecoin-gateway', paymentMethod='wallet'
 *   anything else        → source='payment-engine',     paymentMethod='card'
 */

import { v4 as uuidv4 } from 'uuid';
import type { ForgePayEvent, PaymentEventData } from '../types/events.js';
import type { AgentContext } from '../lib/kyapay-jwt.js';

export interface KYAPayPaymentInput {
  agentContext: AgentContext;
  paymentId:   string;
  amount:      { value: string; currency: string };
  description?: string;
  metadata?:   Record<string, string>;
}

const STABLECOIN_ASSETS = new Set(['USDC', 'USDT', 'PYUSD', 'EURC']);

export function normalizeKYAPayPayment(input: KYAPayPaymentInput): ForgePayEvent {
  const { agentContext: ctx } = input;
  const now = new Date().toISOString();

  const isStablecoin = STABLECOIN_ASSETS.has((ctx.settlementAsset ?? '').toUpperCase());

  const data: PaymentEventData = {
    paymentId:     input.paymentId,
    amount:        { value: input.amount.value, currency: input.amount.currency },
    status:        'created',
    paymentMethod: isStablecoin ? 'wallet' : 'card',
    metadata: {
      ...input.metadata,
      kyapay_sub:        ctx.kyapaySubject,
      kyapay_iss:        ctx.kyapayIssuer,
      kyc_verified:      String(ctx.kycVerified),
      settlement_asset:  ctx.settlementAsset ?? 'USD',
      settlement_chain:  ctx.settlementChain ?? '',
      ...(ctx.businessName  ? { business_name: ctx.businessName }  : {}),
      ...(ctx.jurisdiction  ? { jurisdiction:  ctx.jurisdiction }   : {}),
      ...(input.description ? { description:   input.description }  : {}),
    },
  };

  return {
    id:            uuidv4(),
    type:          'payment.created',
    source:        isStablecoin ? 'stablecoin-gateway' : 'payment-engine',
    merchantId:    ctx.merchantId,
    occurredAt:    now,
    processedAt:   now,
    data,
    rawPayload:    { agentContext: ctx as unknown as Record<string, unknown>, input: { ...input } as unknown as Record<string, unknown> },
    sourceEventId: ctx.jti ?? `kyapay-${input.paymentId}`,
    apiVersion:    '2026-04',
  };
}
