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
 *   POST /webhooks/stablecoin   ← stablecoin-gateway (USDC/USDT + x402 — port 8020)
 *   POST /webhooks/crypto       ← crypto-gateway (BTC/ETH/LTC/XMR invoices — port 8030)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { verifyHmacSignature } from '../lib/crypto.js';
import { deduplicateEvent } from '../lib/dedup.js';
import { normalizeHyperswitchEvent } from '../normalizers/hyperswitch.js';
import { normalizeKillBillEvent } from '../normalizers/killbill.js';
import { normalizeStablecoinEvent } from '../normalizers/stablecoin.js';
import { normalizeCryptoEvent } from '../normalizers/crypto.js';
import { normalizeForgeCustodyEvent, normalizeForgeWalletEvent } from '../normalizers/forge.js';
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

  // ── FORGE Custody (institutional 4-of-7 threshold signing) ────────────────
  // Timestamped scheme: HMAC-SHA256 over `${x-forge-timestamp}.${rawBody}`
  // with a ±5-minute freshness window (replay guard).
  app.post<{ Body: WebhookBody }>(
    '/forge-custody',
    { config: { rawBody: true } },
    async (req, reply) => {
      await handleIncomingWebhook({
        req, reply,
        source: 'forge-custody',
        secret: config.webhookSecrets.forgeCustody,
        signatureHeader: 'x-forge-signature',
        timestampHeader: 'x-forge-timestamp',
        normalize: normalizeForgeCustodyEvent,
      });
    },
  );

  // ── FORGE Wallet (consumer/agent wallets, did:forge identity) ─────────────
  app.post<{ Body: WebhookBody }>(
    '/forge-wallet',
    { config: { rawBody: true } },
    async (req, reply) => {
      await handleIncomingWebhook({
        req, reply,
        source: 'forge-wallet',
        secret: config.webhookSecrets.forgeWallet,
        signatureHeader: 'x-forge-signature',
        timestampHeader: 'x-forge-timestamp',
        normalize: normalizeForgeWalletEvent,
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
  /**
   * When set, the HMAC is computed over `${timestamp}.${rawBody}` and the
   * timestamp must be within ±5 minutes (replay protection). Used by the
   * FORGE Custody / FORGE Wallet emitters.
   */
  timestampHeader?: string;
  normalize:       (body: WebhookBody) => ForgePayEvent | null | Promise<ForgePayEvent | null>;
}

const TIMESTAMP_WINDOW_SECONDS = 300;

async function handleIncomingWebhook({
  req, reply, source, secret, signatureHeader, timestampHeader, normalize,
}: HandleWebhookArgs): Promise<void> {
  const rawBody = (req as { rawBody?: Buffer }).rawBody;

  // 1. Verify HMAC signature
  const signature = req.headers[signatureHeader] as string | undefined;
  if (!signature || !rawBody) {
    logger.warn({ source }, 'Missing signature or raw body');
    reply.code(400).send({ error: 'missing_signature' });
    return;
  }

  let signedPayload: Buffer = rawBody;
  if (timestampHeader) {
    const timestamp = req.headers[timestampHeader] as string | undefined;
    const ts = Number(timestamp);
    const now = Math.floor(Date.now() / 1000);
    if (!timestamp || !Number.isFinite(ts) || Math.abs(now - ts) > TIMESTAMP_WINDOW_SECONDS) {
      logger.warn({ source }, 'Missing or stale webhook timestamp');
      reply.code(401).send({ error: 'invalid_timestamp' });
      return;
    }
    signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
  }

  const valid = verifyHmacSignature({ payload: signedPayload, signature, secret });
  if (!valid) {
    logger.warn({ source }, 'Invalid webhook signature');
    reply.code(401).send({ error: 'invalid_signature' });
    return;
  }

  // 2. Normalize to canonical event (normalizer may be async for KB enrichment)
  const event = await normalize(req.body as WebhookBody);
  if (!event) {
    // Unrecognized event type — ack and ignore
    reply.code(200).send({ received: true, processed: false });
    return;
  }

  // 3. Idempotency check (Redis)
  const isDuplicate = await deduplicateEvent(req.server.redis, event.sourceEventId);
  if (isDuplicate) {
    logger.debug({ eventId: event.id, sourceEventId: event.sourceEventId }, 'Duplicate event, skipping');
    reply.code(200).send({ received: true, processed: false, reason: 'duplicate' });
    return;
  }

  // 4. Persist event to Postgres
  await persistEvent(req.server.db, event);

  // 5. Fan-out to merchant webhook endpoints (async — don't block ack)
  dispatchToMerchants(event, req.server.db).catch((err) =>
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
