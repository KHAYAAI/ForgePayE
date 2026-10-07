/**
 * Bank-Specific Webhook Forwarding
 *
 * Receives payment events from the ForgePay crypto-gateway and stablecoin-gateway
 * (via the unified-router), transforms them to the bank's expected format, and
 * forwards them to the bank's configured webhookUrl.
 *
 * Supported transform targets:
 *   - 'forgepay'  — forward as-is (canonical ForgePay format)
 *   - 'iso20022'  — transform to ISO 20022 pacs.002 message structure
 *   - 'custom'    — generic bank envelope with ForgePay metadata
 *
 * The incoming webhook is verified with HMAC-SHA256 using the shared internal
 * webhook secret (INTERNAL_WEBHOOK_SECRET env var). Outbound webhooks are signed
 * with the bank's webhookSigningKey.
 *
 * Routes:
 *   POST /v1/webhooks/payment — receive payment event from ForgePay gateway
 */
import type { FastifyInstance } from 'fastify';
export declare function registerWebhookRoutes(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=webhooks.d.ts.map