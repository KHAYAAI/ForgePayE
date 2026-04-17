/**
 * Webhook ingestion routes
 *
 * Each sub-service posts its raw webhook payload to the matching endpoint below.
 * Every event travels the same 5-step pipeline (see handleIncomingWebhook):
 *
 *   Step 1 — Verify signature
 *     verifyHmacSignature() checks the HMAC-SHA256 header using timingSafeEqual.
 *     An invalid sig returns HTTP 401 immediately; no further processing.
 *
 *   Step 2 — Normalise
 *     normalizeXxxEvent() maps the raw vendor payload to a canonical ForgePayEvent.
 *     Returns null for unknown event types → we ACK with 200 and skip the rest.
 *
 *   Step 3 — Deduplicate
 *     deduplicateEvent() writes sourceEventId to Redis with a 7-day TTL.
 *     If the key already exists the event is a duplicate; we ACK and skip persist+dispatch.
 *
 *   Step 4 — Persist
 *     persistEvent() INSERTs into forgepay_events with ON CONFLICT DO NOTHING
 *     as a second idempotency guard (handles Redis eviction edge case).
 *
 *   Step 5 — Fan-out (fire-and-forget)
 *     dispatchToMerchants() is called without await so we never delay the ACK.
 *     Queries merchant_webhook_endpoints, delivers with HMAC signature + retry.
 *
 * Webhook endpoints:
 *   POST /webhooks/hyperswitch  ← payment-engine (Hyperswitch)
 *   POST /webhooks/killbill     ← billing-engine (Kill Bill)
 *   POST /webhooks/stablecoin   ← stablecoin-gateway (ZeroPay fork — NOT YET BUILT)
 *   POST /webhooks/crypto       ← crypto-gateway (Keagate fork — NOT YET BUILT)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyHmacSignature } from '../lib/crypto.js';
import { deduplicateEvent } from '../lib/dedup.js';
import { normalizeHyperswitchEvent } from '../normalizers/hyperswitch.js';
import { normalizeKillBillEvent } from '../normalizers/killbill.js';
import { normalizeStablecoinEvent } from '../normalizers/stablecoin.js';
import { normalizeCryptoEvent } from '../normalizers/crypto.js';
import { dispatchToMerchants } from '../lib/dispatch.js';
import { config } from '../config.js';
import { logger } from '../lib/logger.js';
import type { ForgePayEvent } from '../types/events.js';

interface WebhookBody {
  [key: string]: unknown;
}

export async function buildWebhookRoutes(app: FastifyInstance) {
  // ── Hyperswitch (payment-engine) ──────────────────────────────────────────
  app.post<{ Body: WebhookBody }>(
    '/hyperswitch',
    { config: { rawBody: true } },
    async (req, reply) => {
      await handleIncomingWebhook({
        req, reply,
        source: 'payment-engine',
        secret: config.webhookSecrets.hyperswitch,
        signatureHeader: 'x-webhook-signature-512',
        normalize: normalizeHyperswitchEvent,
      });
    },
  );

  // ── Kill Bill (billing-engine) ────────────────────────────────────────────
  app.post<{ Body: WebhookBody }>(
    '/killbill',
    { config: { rawBody: true } },
    async (req, reply) => {
      await handleIncomingWebhook({
        req, reply,
        source: 'billing-engine',
        secret: config.webhookSecrets.killbill,
        signatureHeader: 'x-killbill-signature',
        normalize: normalizeKillBillEvent,
      });
    },
  );

  // ── Stablecoin gateway (ZeroPay fork) ─────────────────────────────────────
  app.post<{ Body: WebhookBody }>(
    '/stablecoin',
    { config: { rawBody: true } },
    async (req, reply) => {
      await handleIncomingWebhook({
        req, reply,
        source: 'stablecoin-gateway',
        secret: config.webhookSecrets.stablecoinGateway,
        signatureHeader: 'x-forgepay-sig',
        normalize: normalizeStablecoinEvent,
      });
    },
  );

  // ── Crypto gateway (Keagate fork) ─────────────────────────────────────────
  app.post<{ Body: WebhookBody }>(
    '/crypto',
    { config: { rawBody: true } },
    async (req, reply) => {
      await handleIncomingWebhook({
        req, reply,
        source: 'crypto-gateway',
        secret: config.webhookSecrets.cryptoGateway,
        signatureHeader: 'x-forgepay-sig',
        normalize: normalizeCryptoEvent,
      });
    },
  );
}

// ── Shared handler ─────────────────────────────────────────────────────────

interface HandleWebhookArgs {
  req:             FastifyRequest;
  reply:           FastifyReply;
  source:          string;
  secret:          string;
  signatureHeader: string;
  normalize:       (body: WebhookBody) => ForgePayEvent | null;
}

async function handleIncomingWebhook({
  req, reply, source, secret, signatureHeader, normalize,
}: HandleWebhookArgs): Promise<void> {
  const rawBody = (req as { rawBody?: Buffer }).rawBody;

  // 1. Verify HMAC signature
  const signature = req.headers[signatureHeader] as string | undefined;
  if (!signature || !rawBody) {
    logger.warn({ source }, 'Missing signature or raw body');
    reply.code(400).send({ error: 'missing_signature' });
    return;
  }

  const valid = verifyHmacSignature({ payload: rawBody, signature, secret });
  if (!valid) {
    logger.warn({ source }, 'Invalid webhook signature');
    reply.code(401).send({ error: 'invalid_signature' });
    return;
  }

  // 2. Normalize to canonical event
  const event = normalize(req.body as WebhookBody);
  if (!event) {
    // Unrecognized event type — ack and ignore
    reply.code(200).send({ received: true, processed: false });
    return;
  }

  // 3. Idempotency check (Redis)
  const isDuplicate = await deduplicateEvent(
    (req.server as { redis: { get: (k: string) => Promise<string | null>; set: (k: string, v: string, ex: string, t: number) => Promise<void> } }).redis,
    event.sourceEventId,
  );
  if (isDuplicate) {
    logger.debug({ eventId: event.id, sourceEventId: event.sourceEventId }, 'Duplicate event, skipping');
    reply.code(200).send({ received: true, processed: false, reason: 'duplicate' });
    return;
  }

  // 4. Persist event to Postgres
  await persistEvent((req.server as { db: unknown }).db, event);

  // 5. Fan-out to merchant webhook endpoints (async — don't block ack)
  const db = (req.server as { db: unknown }).db;
  dispatchToMerchants(event, db as Parameters<typeof dispatchToMerchants>[1]).catch((err) =>
    logger.error({ err, eventId: event.id }, 'Merchant dispatch error'),
  );

  logger.info({ eventId: event.id, type: event.type, merchantId: event.merchantId }, 'Event processed');
  reply.code(200).send({ received: true, eventId: event.id });
}

async function persistEvent(db: unknown, event: ForgePayEvent): Promise<void> {
  const pool = db as { query: (sql: string, params: unknown[]) => Promise<void> };
  await pool.query(
    `INSERT INTO forgepay_events
       (id, type, source, merchant_id, occurred_at, processed_at, data, raw_payload, source_event_id, api_version)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (source_event_id) DO NOTHING`,
    [
      event.id,
      event.type,
      event.source,
      event.merchantId,
      event.occurredAt,
      event.processedAt,
      JSON.stringify(event.data),
      JSON.stringify(event.rawPayload),
      event.sourceEventId,
      event.apiVersion,
    ],
  );
}
