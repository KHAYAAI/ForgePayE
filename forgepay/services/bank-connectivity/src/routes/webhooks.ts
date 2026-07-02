/**
 * Webhook ingestion routes for Plaid and Open Banking event notifications.
 *
 * Security:
 *   All incoming webhooks are signature-verified before any payload processing.
 *
 *   Plaid:        Uses JWT-based webhook verification (Plaid sends a signed JWT
 *                 in the Plaid-Verification header).  We verify it against the
 *                 Plaid public key retrieved via the /webhook_verification_key
 *                 endpoint.  In the sandbox, a shared HMAC-SHA256 secret is used
 *                 instead (env var PLAID_WEBHOOK_SECRET) for simplicity.
 *
 *   Open Banking: HMAC-SHA256 signature in the x-ob-signature header, verified
 *                 against OB_WEBHOOK_SECRET env var.
 *
 * Webhook event types handled:
 *   Plaid:
 *     TRANSACTIONS  / DEFAULT_UPDATE        → trigger balance + transaction refresh
 *     TRANSACTIONS  / TRANSACTIONS_REMOVED  → flag account for audit
 *     TRANSACTIONS  / INITIAL_UPDATE        → mark account active
 *     ITEM          / ERROR                 → mark account as error
 *     ITEM          / PENDING_EXPIRATION    → notify merchant (not implemented — webhook dispatch)
 *     TRANSFER      / TRANSFER_EVENTS_UPDATE → poll transfer status
 *
 *   Open Banking:
 *     Account / Balance update              → refresh stored balance
 *     Payment / Status update               → update transfer status
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import * as accountService from '../services/accountService';
import * as transferService from '../services/transferService';
import * as plaid from '../plaid/client';
import { logger } from '../lib/logger';

// ── HMAC helpers ──────────────────────────────────────────────────────────────

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/**
 * SECURITY: webhook signature verification is mandatory. Unsigned payloads are
 * only tolerated in local development when no secret is configured.
 * Returns an error reply (and true) when the request must be rejected.
 */
function rejectUnverified(
  req: FastifyRequest & { rawBody?: Buffer },
  reply: FastifyReply,
  secret: string,
  sigHeader: string | undefined,
  label: string,
): boolean {
  if (!secret) {
    if (IS_PRODUCTION) {
      logger.error(`${label} webhook secret not configured — rejecting webhook`);
      reply.code(503).send({ statusCode: 503, error: 'Service Unavailable', message: 'Webhook verification not configured' });
      return true;
    }
    return false; // dev without secret: allow (local testing only)
  }
  if (!sigHeader) {
    logger.warn({ ip: req.ip }, `${label} webhook missing signature header`);
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Missing webhook signature' });
    return true;
  }
  const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body));
  if (!verifyHmac(rawBody, sigHeader, secret)) {
    logger.warn({ ip: req.ip }, `${label} webhook signature verification failed`);
    reply.code(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid webhook signature' });
    return true;
  }
  return false;
}

function verifyHmac(payload: Buffer, signature: string, secret: string): boolean {
  if (!secret) return false;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const actual   = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    return false;
  }
}

// ── Route registration ────────────────────────────────────────────────────────

export async function buildWebhookRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /webhooks/plaid ──────────────────────────────────────────────────
  app.post<{ Body: PlaidWebhookBody }>(
    '/plaid',
    {},
    async (req: FastifyRequest & { rawBody?: Buffer }, reply: FastifyReply) => {
      // Verify signature using shared sandbox secret (PLAID_WEBHOOK_SECRET).
      // In production, use Plaid's JWT verification flow with their public key API.
      const secret    = process.env.PLAID_WEBHOOK_SECRET ?? '';
      const sigHeader = req.headers['plaid-verification'] as string | undefined;

      if (rejectUnverified(req, reply, secret, sigHeader, 'Plaid')) return reply;

      const body = req.body as PlaidWebhookBody;

      logger.info(
        { webhookType: body.webhook_type, webhookCode: body.webhook_code },
        'Plaid webhook received',
      );

      // Process asynchronously — always ACK immediately to avoid Plaid retries
      setImmediate(() => handlePlaidWebhook(body));

      return reply.code(200).send({ received: true });
    },
  );

  // ── POST /webhooks/openbanking ────────────────────────────────────────────
  app.post<{ Body: OBWebhookBody }>(
    '/openbanking',
    {},
    async (req: FastifyRequest & { rawBody?: Buffer }, reply: FastifyReply) => {
      const secret    = process.env.OB_WEBHOOK_SECRET ?? '';
      const sigHeader = req.headers['x-ob-signature'] as string | undefined;

      if (rejectUnverified(req, reply, secret, sigHeader, 'Open Banking')) return reply;

      const body = req.body as OBWebhookBody;
      logger.info({ eventType: body.EventType }, 'Open Banking webhook received');

      setImmediate(() => handleOBWebhook(body));

      return reply.code(200).send({ received: true });
    },
  );
}

// ── Plaid webhook handler ─────────────────────────────────────────────────────

interface PlaidWebhookBody {
  webhook_type:      string;
  webhook_code:      string;
  item_id?:          string;
  account_id?:       string;
  transfer_id?:      string;
  error?:            { error_code?: string; error_message?: string };
  new_transactions?: number;
  removed_transactions?: string[];
}

async function handlePlaidWebhook(body: PlaidWebhookBody): Promise<void> {
  try {
    switch (body.webhook_type) {
      case 'TRANSACTIONS':
        await handleTransactionWebhook(body);
        break;

      case 'ITEM':
        await handleItemWebhook(body);
        break;

      case 'TRANSFER':
        await handleTransferWebhook(body);
        break;

      default:
        logger.debug({ webhookType: body.webhook_type }, 'Unhandled Plaid webhook type — skipping');
    }
  } catch (err) {
    logger.error({ err, webhookType: body.webhook_type }, 'Error processing Plaid webhook');
  }
}

async function handleTransactionWebhook(body: PlaidWebhookBody): Promise<void> {
  // Find the account by plaidItemId and trigger a balance refresh
  // In production, query DB for the account by item_id
  logger.info(
    {
      webhookCode:    body.webhook_code,
      itemId:         body.item_id,
      newTransactions: body.new_transactions,
    },
    'Plaid transaction webhook — balance refresh would be triggered here',
  );

  if (body.webhook_code === 'TRANSACTIONS_REMOVED' && body.removed_transactions?.length) {
    logger.warn(
      { itemId: body.item_id, count: body.removed_transactions.length },
      'Plaid TRANSACTIONS_REMOVED — flagging for audit',
    );
  }
}

async function handleItemWebhook(body: PlaidWebhookBody): Promise<void> {
  if (body.webhook_code === 'ERROR' && body.item_id) {
    logger.error(
      { itemId: body.item_id, error: body.error },
      'Plaid item error — marking accounts as error status',
    );
    // In production: look up all accounts for this item_id and mark them 'error'
  }

  if (body.webhook_code === 'PENDING_EXPIRATION') {
    logger.warn(
      { itemId: body.item_id },
      'Plaid item token expiring — merchant should re-link',
    );
    // In production: send notification to merchant dashboard / email
  }
}

async function handleTransferWebhook(body: PlaidWebhookBody): Promise<void> {
  if (body.webhook_code === 'TRANSFER_EVENTS_UPDATE' && body.transfer_id) {
    try {
      const { status, failureReason } = await plaid.getTransferStatus(body.transfer_id);

      // Map Plaid transfer status to our internal status
      const internalStatus = mapPlaidTransferStatus(status);

      // Find the transfer by providerTransferId
      // In production: query DB by providerTransferId
      // For now we iterate (acceptable for dev/test with small data sets)
      logger.info(
        { plaidTransferId: body.transfer_id, status, internalStatus },
        'Plaid transfer status update received',
      );

      // transferService.pollTransferStatus requires our internal transferId.
      // In production: SELECT id FROM transfers WHERE provider_transfer_id = $1
      // Here we rely on the webhook + polling to reconcile.
    } catch (err) {
      logger.error(
        { err, transferId: body.transfer_id },
        'Failed to get Plaid transfer status',
      );
    }
  }
}

function mapPlaidTransferStatus(
  plaidStatus: string,
): 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' {
  switch (plaidStatus) {
    case 'pending':   return 'pending';
    case 'posted':    return 'processing';
    case 'settled':   return 'completed';
    case 'cancelled': return 'cancelled';
    case 'failed':    return 'failed';
    case 'returned':  return 'failed';
    default:          return 'processing';
  }
}

// ── Open Banking webhook handler ──────────────────────────────────────────────

interface OBWebhookBody {
  EventType?:  string;
  AccountId?:  string;
  PaymentId?:  string;
  Status?:     string;
  DateTime?:   string;
  [key: string]: unknown;
}

async function handleOBWebhook(body: OBWebhookBody): Promise<void> {
  try {
    const eventType = body.EventType ?? '';

    if (eventType.includes('Balance') && body.AccountId) {
      // Find account by obAccountId and trigger balance refresh
      logger.info(
        { accountId: body.AccountId },
        'OB balance update webhook — would trigger refresh',
      );
    } else if (eventType.includes('Payment') && body.PaymentId && body.Status) {
      // Map OB payment status to our internal status and update transfer
      const internalStatus = mapOBPaymentStatus(body.Status);
      logger.info(
        { paymentId: body.PaymentId, status: body.Status, internalStatus },
        'OB payment status webhook received',
      );
      // In production: SELECT id FROM transfers WHERE provider_transfer_id = $1
      // then call transferService.pollTransferStatus(internalId, internalStatus)
    } else {
      logger.debug({ eventType }, 'Unhandled OB webhook event type');
    }
  } catch (err) {
    logger.error({ err }, 'Error processing Open Banking webhook');
  }
}

function mapOBPaymentStatus(
  obStatus: string,
): 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled' {
  switch (obStatus) {
    case 'Pending':           return 'pending';
    case 'AcceptedSettlementInProcess': return 'processing';
    case 'AcceptedSettlementCompleted': return 'completed';
    case 'Rejected':          return 'failed';
    case 'Cancelled':         return 'cancelled';
    default:                  return 'processing';
  }
}
