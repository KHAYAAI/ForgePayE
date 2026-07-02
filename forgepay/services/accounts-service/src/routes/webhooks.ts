import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { config } from '../config.js';

interface CircleWebhookBody {
  id?:    string;
  type?:  string;
  data?:  { object?: Record<string, unknown> };
}

function verifyCircleSignature(raw: Buffer, header: string): boolean {
  const secret = config.circle.webhookSecret;
  if (!secret) return config.env === 'development'; // skip verification in dev

  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function buildWebhookRoutes(app: FastifyInstance) {
  const db = getDb();

  app.post<{ Body: CircleWebhookBody }>(
    '/circle',
    { config: { rawBody: true } },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const rawBody  = (req as unknown as { rawBody?: Buffer }).rawBody;
      const sigHeader = req.headers['x-circle-signature'] as string | undefined;

      if (!rawBody) {
        reply.code(400).send({ error: 'missing_body' });
        return;
      }

      // SECURITY: unsigned payloads must be rejected — this route mutates balances.
      // Only exception: local development with no webhook secret configured.
      const devUnsignedAllowed = !config.circle.webhookSecret && config.env === 'development';
      if (!devUnsignedAllowed) {
        if (!sigHeader) {
          req.log.warn('Missing Circle webhook signature');
          reply.code(401).send({ error: 'missing_signature' });
          return;
        }
        if (!verifyCircleSignature(rawBody, sigHeader)) {
          req.log.warn('Invalid Circle webhook signature');
          reply.code(401).send({ error: 'invalid_signature' });
          return;
        }
      }

      const body = req.body as CircleWebhookBody;
      const eventType = body.type ?? '';
      const obj = body.data?.object ?? {};

      req.log.info({ eventType, eventId: body.id }, 'Circle webhook received');

      try {
        if (eventType === 'payments.updated') {
          await handlePaymentUpdated(obj, db, req);
        } else if (eventType === 'payouts.updated') {
          await handlePayoutUpdated(obj, db, req);
        } else if (eventType === 'transfers.updated') {
          await handleTransferUpdated(obj, db, req);
        }
      } catch (err) {
        req.log.error({ err, eventType }, 'Circle webhook processing error');
        // Still return 200 so Circle doesn't retry indefinitely
      }

      reply.code(200).send({ received: true });
    },
  );
}

// ── Handlers ──────────────────────────────────────────────────────────────────

async function handlePaymentUpdated(
  obj: Record<string, unknown>,
  db: ReturnType<typeof getDb>,
  req: FastifyRequest,
): Promise<void> {
  const intentId = obj['id'] as string | undefined;
  const status   = obj['status'] as string | undefined;

  if (!intentId || status !== 'complete') return;

  const result = await db.query(
    `SELECT id, account_id, amount_units FROM fp_deposits WHERE circle_intent_id = $1 AND status != 'confirmed'`,
    [intentId],
  );
  if (result.rows.length === 0) return;

  const deposit = result.rows[0] as Record<string, unknown>;
  const depositId   = deposit['id'] as string;
  const accountId   = deposit['account_id'] as string;
  const amountUnits = deposit['amount_units'] as string;

  await db.query(
    `UPDATE fp_deposits SET status = 'confirmed', confirmed_at = now() WHERE id = $1`,
    [depositId],
  );
  await db.query(
    `UPDATE fp_accounts
     SET balance_usdc = balance_usdc + $1::numeric / 1000000, updated_at = now()
     WHERE id = $2`,
    [amountUnits, accountId],
  );

  req.log.info({ depositId, accountId }, 'Deposit confirmed via Circle webhook');
}

async function handlePayoutUpdated(
  obj: Record<string, unknown>,
  db: ReturnType<typeof getDb>,
  req: FastifyRequest,
): Promise<void> {
  const payoutId = obj['id'] as string | undefined;
  const status   = obj['status'] as string | undefined;

  if (!payoutId || (status !== 'complete' && status !== 'failed')) return;

  const newStatus = status === 'complete' ? 'completed' : 'failed';

  const result = await db.query(
    `UPDATE fp_withdrawals
     SET status       = $1,
         completed_at = CASE WHEN $1 = 'completed' THEN now() ELSE completed_at END,
         updated_at   = now()
     WHERE circle_payout_id = $2 AND status NOT IN ('completed', 'failed')
     RETURNING id, account_id, amount_usd`,
    [newStatus, payoutId],
  );

  if (result.rows.length > 0) {
    const row = result.rows[0] as Record<string, unknown>;
    req.log.info({ withdrawalId: row['id'], status: newStatus }, 'Withdrawal updated via Circle webhook');

    // If payout failed, refund the balance
    if (newStatus === 'failed') {
      await db.query(
        `UPDATE fp_accounts SET balance_usdc = balance_usdc + $1, updated_at = now() WHERE id = $2`,
        [row['amount_usd'], row['account_id']],
      );
      req.log.warn({ withdrawalId: row['id'] }, 'Withdrawal failed — balance refunded');
    }
  }
}

async function handleTransferUpdated(
  obj: Record<string, unknown>,
  db: ReturnType<typeof getDb>,
  req: FastifyRequest,
): Promise<void> {
  const transferId = obj['id'] as string | undefined;
  const status     = obj['status'] as string | undefined;
  const txHash     = (obj['transactionHash'] ?? obj['transaction_hash']) as string | undefined;

  if (!transferId || status !== 'complete') return;

  // Transfers may correspond to direct on-chain deposits (no Circle intent)
  if (txHash) {
    await db.query(
      `UPDATE fp_deposits
       SET status = 'confirmed', tx_hash = $1, confirmed_at = now()
       WHERE tx_hash IS NULL AND deposit_address = $2 AND status != 'confirmed'`,
      [txHash, obj['destination']],
    );
    req.log.info({ txHash }, 'Direct deposit confirmed via Circle transfer webhook');
  }
}
