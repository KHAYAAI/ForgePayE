/**
 * Agent-initiated payment route.
 *
 * POST /v1/payments — accepts a KYAPay Bearer JWT + payment body.
 * The JWT replaces the HMAC signature used for webhook ingestion.
 *
 * Pipeline (mirrors webhooks.ts — same 5 steps):
 *   1. Verify KYAPay JWT (ES256, trusted issuer list, spend-limit guard)
 *   2. Normalize to canonical ForgePayEvent via normalizeKYAPayPayment()
 *   3. Deduplicate via Redis (keyed on JWT jti or generated paymentId)
 *   4. Persist to forgepay_events
 *   5. Fan-out to merchant webhook endpoints (fire-and-forget)
 */

import type { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import { verifyKYAPayToken, extractAgentContext } from '../lib/kyapay-jwt.js';
import { normalizeKYAPayPayment } from '../normalizers/kyapay.js';
import { deduplicateEvent } from '../lib/dedup.js';
import { dispatchToMerchants } from '../lib/dispatch.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { ForgePayEvent } from '../types/events.js';

interface ServerDecorations {
  redis: {
    get: (k: string) => Promise<string | null>;
    set: (k: string, v: string, ex: string, t: number) => Promise<void>;
  };
  db: { query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }> };
}

export async function buildPaymentRoutes(app: FastifyInstance) {
  app.post<{ Body: Record<string, unknown> }>('/v1/payments', async (req, reply) => {
    // 1. Extract and verify Bearer JWT
    const authHeader = req.headers['authorization'];
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'missing_bearer_token' });
    }

    let claims;
    try {
      claims = await verifyKYAPayToken(authHeader.slice(7), {
        trustedIssuers: config.kyapay.trustedIssuers,
      });
    } catch (err) {
      logger.warn({ reason: (err as Error).message }, 'KYAPay JWT verification failed');
      return reply.code(401).send({
        error:   'invalid_kyapay_token',
        message: (err as Error).message,
      });
    }

    const agentCtx = extractAgentContext(claims);

    // Validate payment body
    const body = req.body;
    const amt  = body['amount'] as Record<string, unknown> | undefined;
    if (!amt || typeof amt['value'] !== 'string' || typeof amt['currency'] !== 'string') {
      return reply.code(400).send({
        error:   'ValidationError',
        message: 'amount.value (string) and amount.currency (string) are required',
      });
    }

    // Spend-limit guard — token's value claim caps the request amount
    if (claims.value !== undefined) {
      const tokenLimit = parseFloat(claims.value);
      const requested  = parseFloat(amt['value'] as string);
      if (Number.isNaN(requested) || requested > tokenLimit) {
        return reply.code(422).send({
          error:   'spend_limit_exceeded',
          message: `Requested ${requested} ${amt['currency']} exceeds token limit ${tokenLimit}`,
        });
      }
    }

    // 2. Normalize
    const paymentId = uuidv4();
    const event = normalizeKYAPayPayment({
      agentContext: agentCtx,
      paymentId,
      amount:      { value: amt['value'] as string, currency: amt['currency'] as string },
      description: body['description'] as string | undefined,
      metadata:    body['metadata'] as Record<string, string> | undefined,
    });

    const server = req.server as unknown as ServerDecorations;

    // 3. Deduplicate
    const isDuplicate = await deduplicateEvent(server.redis, event.sourceEventId);
    if (isDuplicate) {
      logger.debug({ sourceEventId: event.sourceEventId }, 'Duplicate KYAPay payment skipped');
      return reply.code(200).send({ received: true, processed: false, reason: 'duplicate' });
    }

    // 4. Persist
    await persistEvent(server.db, event);

    // 5. Fan-out (fire-and-forget)
    dispatchToMerchants(event, server.db as Parameters<typeof dispatchToMerchants>[1]).catch((err) =>
      logger.error({ err, eventId: event.id }, 'Merchant dispatch error (KYAPay)'),
    );

    logger.info({
      eventId:    event.id,
      kyapaySub:  agentCtx.kyapaySubject,
      merchantId: agentCtx.merchantId,
      amount:     `${amt['value']} ${amt['currency']}`,
    }, 'KYAPay payment created');

    return reply.code(201).send({
      eventId:   event.id,
      paymentId,
      status:    'created',
    });
  });
}

async function persistEvent(
  db: ServerDecorations['db'],
  event: ForgePayEvent,
): Promise<void> {
  await db.query(
    `INSERT INTO forgepay_events
       (id, type, source, merchant_id, occurred_at, processed_at, data, raw_payload, source_event_id, api_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (source_event_id) DO NOTHING`,
    [
      event.id, event.type, event.source, event.merchantId,
      event.occurredAt, event.processedAt,
      JSON.stringify(event.data), JSON.stringify(event.rawPayload),
      event.sourceEventId, event.apiVersion,
    ],
  );
}
