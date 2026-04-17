/**
 * Merchant webhook dispatch — fan out canonical events to merchant endpoints.
 *
 * Features:
 *   - Fetches active endpoint URLs from merchant_webhook_endpoints table
 *   - Exponential backoff retries (up to 5 attempts)
 *   - HMAC-SHA256 signed payloads
 *   - Per-event delivery log stored in Postgres
 *   - Non-blocking: called as fire-and-forget from the webhook handler
 */

import { createHmac } from 'node:crypto';
import { config } from '../config.js';
import { logger } from './logger.js';
import type { ForgePayEvent } from '../types/events.js';

const RETRY_DELAYS_MS = [1_000, 5_000, 30_000, 120_000, 600_000]; // 1s, 5s, 30s, 2m, 10m

type DbPool = {
  query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
};

interface EndpointRow {
  id:             string;
  endpoint_url:   string;
  signing_secret: string;
}

export async function dispatchToMerchants(event: ForgePayEvent, db: DbPool): Promise<void> {
  // Fetch all enabled webhook endpoints for this merchant.
  let rows: EndpointRow[] = [];
  try {
    const result = await db.query(
      `SELECT id, endpoint_url, signing_secret
         FROM merchant_webhook_endpoints
        WHERE merchant_id = $1
          AND enabled = true`,
      [event.merchantId],
    );
    rows = result.rows as EndpointRow[];
  } catch (err) {
    logger.error({ err, eventId: event.id }, 'Failed to fetch merchant webhook endpoints');
    return;
  }

  if (rows.length === 0) return;

  await Promise.allSettled(
    rows.map((ep) => deliverWithRetry(event, ep, db)),
  );
}

async function deliverWithRetry(
  event:    ForgePayEvent,
  endpoint: EndpointRow,
  db:       DbPool,
): Promise<void> {
  const body     = JSON.stringify(event);
  const maxTries = config.merchantWebhookMaxRetries;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const signature = signPayload(body, endpoint.signing_secret);
    const startedAt = Date.now();

    let statusCode = 0;
    let succeeded  = false;

    try {
      const res = await fetch(endpoint.endpoint_url, {
        method:  'POST',
        headers: {
          'Content-Type':        'application/json',
          'X-ForgePay-Event':    event.type,
          'X-ForgePay-Delivery': event.id,
          'X-ForgePay-Sig':      `sha256=${signature}`,
          'User-Agent':          'ForgePay-Webhooks/2026-04',
        },
        body,
        signal: AbortSignal.timeout(config.merchantWebhookTimeoutMs),
      });

      statusCode = res.status;
      succeeded  = res.ok;

      if (res.ok) {
        logger.debug({ eventId: event.id, url: endpoint.endpoint_url, attempt }, 'Webhook delivered');
      } else {
        logger.warn({ eventId: event.id, url: endpoint.endpoint_url, status: res.status, attempt }, 'Webhook delivery failed');
      }
    } catch (err) {
      logger.warn({ err, eventId: event.id, url: endpoint.endpoint_url, attempt }, 'Webhook delivery error');
    }

    // Log delivery attempt to Postgres for dashboard delivery history view.
    try {
      await db.query(
        `INSERT INTO webhook_delivery_log
           (id, event_id, endpoint_id, attempt, status_code, succeeded, attempted_at, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          crypto.randomUUID(),
          event.id,
          endpoint.id,
          attempt + 1,
          statusCode,
          succeeded,
          new Date().toISOString(),
          Date.now() - startedAt,
        ],
      );
    } catch (logErr) {
      logger.warn({ logErr }, 'Failed to log webhook delivery attempt');
    }

    if (succeeded) return;

    // Don't sleep after the last attempt
    if (attempt < maxTries - 1) {
      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1) ?? 600_000;
      await sleep(delay);
    }
  }

  logger.error({ eventId: event.id, url: endpoint.endpoint_url }, 'Webhook delivery exhausted all retries');
}

function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
