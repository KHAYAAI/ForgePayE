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
import { Banks, Customers, Transactions } from '../store.js';
import { createHmac, randomUUID } from 'node:crypto';
import { BankTransaction } from '../types.js';

interface ForgePayPaymentEvent {
  event_type:   'payment.confirmed' | 'payment.failed' | 'payment.refunded';
  payment_id:   string;
  bank_id:      string;
  customer_ref: string;
  asset:        string;
  amount_crypto: number;
  amount_usd:   number;
  fee_usd:      number;
  tx_hash?:     string;
  payment_type: 'crypto_purchase' | 'crypto_sale' | 'stablecoin_deposit' | 'stablecoin_withdrawal';
  timestamp:    string;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  const internalSecret = process.env['INTERNAL_WEBHOOK_SECRET'] ?? 'dev_internal_webhook_secret';

  app.post<{ Body: ForgePayPaymentEvent }>(
    '/v1/webhooks/payment',
    {
      schema: {
        body: {
          type: 'object',
          required: ['event_type', 'payment_id', 'bank_id', 'customer_ref', 'asset', 'amount_crypto', 'amount_usd', 'fee_usd', 'payment_type', 'timestamp'],
          properties: {
            event_type:    { type: 'string' },
            payment_id:    { type: 'string' },
            bank_id:       { type: 'string' },
            customer_ref:  { type: 'string' },
            asset:         { type: 'string' },
            amount_crypto: { type: 'number' },
            amount_usd:    { type: 'number' },
            fee_usd:       { type: 'number' },
            tx_hash:       { type: 'string' },
            payment_type:  { type: 'string' },
            timestamp:     { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      // ── 1. Verify HMAC signature ──────────────────────────────────────────
      const signature = request.headers['x-forgepay-signature'] as string | undefined;
      if (signature) {
        const bodyStr  = JSON.stringify(request.body);
        const expected = createHmac('sha256', internalSecret).update(bodyStr).digest('hex');
        if (signature !== expected) {
          return reply.status(401).send({ error: 'Invalid webhook signature' });
        }
      }

      const event = request.body;
      const bank  = Banks.findById(event.bank_id);
      if (!bank) return reply.status(404).send({ error: `Bank '${event.bank_id}' not found` });
      if (bank.status !== 'active') {
        return reply.status(422).send({ error: `Bank '${event.bank_id}' is not active` });
      }

      // ── 2. Resolve customer ───────────────────────────────────────────────
      const customer = Customers.findByRef(event.bank_id, event.customer_ref);

      // ── 3. Map event type to transaction status ───────────────────────────
      const statusMap: Record<string, BankTransaction['status']> = {
        'payment.confirmed': 'confirmed',
        'payment.failed':    'failed',
        'payment.refunded':  'refunded',
      };
      const txStatus = statusMap[event.event_type] ?? 'pending';

      // ── 4. Record transaction ─────────────────────────────────────────────
      const customerId = customer?.id ?? `ext:${event.customer_ref}`;
      const now        = new Date().toISOString();

      const txn = Transactions.create({
        id:           event.payment_id,
        bankId:       event.bank_id,
        customerId,
        type:         event.payment_type,
        asset:        event.asset,
        amountCrypto: event.amount_crypto,
        amountUsd:    event.amount_usd,
        feeUsd:       event.fee_usd,
        netAmountUsd: event.amount_usd - event.fee_usd,
        status:       txStatus,
        txHash:       event.tx_hash,
        createdAt:    event.timestamp,
        confirmedAt:  txStatus === 'confirmed' ? now : undefined,
      });

      if (customer && txStatus === 'confirmed') {
        Customers.update(customer.id, event.bank_id, {
          totalVolumeUsd:   customer.totalVolumeUsd + event.amount_usd,
          transactionCount: customer.transactionCount + 1,
        });
      }

      // ── 5. Transform and forward to bank's webhook endpoint ───────────────
      if (bank.webhookUrl) {
        const payload = transformPayload(event, bank.webhookFormat);
        const sig = bank.webhookSigningKey
          ? createHmac('sha256', bank.webhookSigningKey)
              .update(JSON.stringify(payload))
              .digest('hex')
          : undefined;

        forwardWebhook(bank.webhookUrl, payload, sig).catch((err) => {
          app.log.error({ err, bankId: bank.id, paymentId: event.payment_id },
            'Failed to forward webhook to bank');
        });
      }

      return reply.status(202).send({
        received:      true,
        transactionId: txn.id,
        status:        txStatus,
      });
    },
  );
}

// ── Transform helpers ─────────────────────────────────────────────────────────

function transformPayload(
  event: ForgePayPaymentEvent,
  format: 'forgepay' | 'iso20022' | 'custom',
): Record<string, unknown> {
  switch (format) {
    case 'forgepay':
      return event as unknown as Record<string, unknown>;

    case 'iso20022':
      // ISO 20022 pacs.002 — FIToFIPaymentStatusReport structure
      return {
        '@xmlns':    'urn:iso:std:iso:20022:tech:xsd:pacs.002.001.10',
        GrpHdr: {
          MsgId:    randomUUID(),
          CreDtTm:  new Date().toISOString(),
          NbOfTxs:  '1',
        },
        TxInfAndSts: {
          OrgnlTxId:   event.payment_id,
          TxSts:       event.event_type === 'payment.confirmed' ? 'ACCP' : 'RJCT',
          AccptncDtTm: event.timestamp,
          InstdAmt: {
            '@Ccy':  event.asset,
            '#text': event.amount_crypto.toString(),
          },
          EqvtAmt: {
            Amt: { '@Ccy': 'USD', '#text': event.amount_usd.toString() },
          },
          ChrgsAmt: {
            '@Ccy':  'USD',
            '#text': event.fee_usd.toString(),
          },
          TxRef:      event.tx_hash ?? '',
          EndToEndId: event.customer_ref,
        },
      };

    case 'custom':
    default:
      return {
        forgepay_event: event.event_type,
        payment_id:     event.payment_id,
        bank_id:        event.bank_id,
        customer_ref:   event.customer_ref,
        asset:          event.asset,
        amount_crypto:  event.amount_crypto,
        amount_usd:     event.amount_usd,
        fee_usd:        event.fee_usd,
        net_amount_usd: event.amount_usd - event.fee_usd,
        tx_hash:        event.tx_hash,
        payment_type:   event.payment_type,
        occurred_at:    event.timestamp,
        forwarded_at:   new Date().toISOString(),
      };
  }
}

async function forwardWebhook(
  url: string,
  payload: Record<string, unknown>,
  signature?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent':   'ForgePay-Bank-Whitelabel/0.2.0',
  };
  if (signature) headers['x-forgepay-bank-signature'] = signature;

  const resp = await fetch(url, {
    method:  'POST',
    headers,
    body:    JSON.stringify(payload),
    signal:  AbortSignal.timeout(10_000),
  });

  if (!resp.ok) {
    throw new Error(`Bank webhook endpoint returned ${resp.status}`);
  }
}
