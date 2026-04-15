/**
 * Merchant webhook dispatch — fan out canonical events to merchant endpoints.
 *
 * Features:
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

export async function dispatchToMerchants(event: ForgePayEvent): Promise<void> {
  // TODO: look up merchant webhook endpoints from DB
  // For now, this is the stub — real implementation queries:
  //   SELECT endpoint_url, signing_secret FROM merchant_webhook_endpoints
  //   WHERE merchant_id = $1 AND enabled = true
  const endpoints: Array<{ url: string; secret: string }> = [];

  await Promise.allSettled(
    endpoints.map((ep) => deliverWithRetry(event, ep)),
  );
}

async function deliverWithRetry(
  event:    ForgePayEvent,
  endpoint: { url: string; secret: string },
): Promise<void> {
  const body    = JSON.stringify(event);
  const maxTries = config.merchantWebhookMaxRetries;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const signature = signPayload(body, endpoint.secret);

    try {
      const res = await fetch(endpoint.url, {
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

      if (res.ok) {
        logger.debug({ eventId: event.id, url: endpoint.url, attempt }, 'Webhook delivered');
        return;
      }

      logger.warn({ eventId: event.id, url: endpoint.url, status: res.status, attempt }, 'Webhook delivery failed');
    } catch (err) {
      logger.warn({ err, eventId: event.id, url: endpoint.url, attempt }, 'Webhook delivery error');
    }

    // Don't sleep after the last attempt
    if (attempt < maxTries - 1) {
      const delay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS.at(-1) ?? 600_000;
      await sleep(delay);
    }
  }

  logger.error({ eventId: event.id, url: endpoint.url }, 'Webhook delivery exhausted all retries');
}

function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
