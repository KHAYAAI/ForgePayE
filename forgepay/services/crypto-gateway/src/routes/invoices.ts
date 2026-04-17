/**
 * Crypto invoice management API.
 *
 * POST /invoices        — create an invoice (returns a deposit address + expected amount)
 * GET  /invoices/:id    — retrieve invoice status
 * GET  /invoices        — list invoices for a merchant
 *
 * Supported coins: BTC, ETH, LTC, XMR
 *
 * Each invoice gets a fresh deposit address derived from the merchant's HD wallet.
 * The address monitor (lib/monitor.ts) watches for incoming transactions.
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { getUsdPrice, usdToCrypto } from '../lib/prices.js';
import { config } from '../config.js';

type SupportedCoin = 'BTC' | 'ETH' | 'LTC' | 'XMR';

interface CreateInvoiceBody {
  merchant_id:  string;
  amount_usd:   number;
  coin:         SupportedCoin;
  payment_id?:  string;
  description?: string;
  metadata?:    Record<string, string>;
}

export async function buildInvoiceRoutes(app: FastifyInstance) {
  // ── Create invoice ────────────────────────────────────────────────────────
  app.post<{ Body: CreateInvoiceBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['merchant_id', 'amount_usd', 'coin'],
          properties: {
            merchant_id:  { type: 'string' },
            amount_usd:   { type: 'number', minimum: 0.01 },
            coin:         { type: 'string', enum: ['BTC', 'ETH', 'LTC', 'XMR'] },
            payment_id:   { type: 'string' },
            description:  { type: 'string' },
            metadata:     { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      const { merchant_id, amount_usd, coin, payment_id, description, metadata } = req.body;

      // Get live price and compute expected crypto amount
      let priceUsd    = 0;
      let amountCrypto = 0;
      try {
        priceUsd     = await getUsdPrice(coin);
        amountCrypto = usdToCrypto(amount_usd, priceUsd);
      } catch {
        reply.code(503).send({ error: `Unable to fetch ${coin} price` });
        return;
      }

      // Generate a fresh deposit address.
      // Production: derive from merchant HD wallet using BIP32 path.
      // Dev: generate a random address (not backed by real keys).
      const address = generateAddress(coin);

      const invoiceId = randomUUID();
      const expiresAt = new Date(Date.now() + config.invoiceExpirySeconds * 1000).toISOString();

      const db = getDb();
      await db.query(
        `INSERT INTO crypto_invoices
           (id, merchant_id, address, coin, amount_usd, amount_crypto, price_usd_at_creation,
            payment_id, description, metadata, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,now())`,
        [
          invoiceId,
          merchant_id,
          address,
          coin,
          amount_usd,
          amountCrypto.toFixed(8),
          priceUsd,
          payment_id ?? null,
          description ?? null,
          metadata ? JSON.stringify(metadata) : null,
          expiresAt,
        ],
      );

      reply.code(201).send({
        id:           invoiceId,
        address,
        coin,
        amount_usd,
        amount_crypto: amountCrypto.toFixed(8),
        price_usd:    priceUsd,
        expires_at:   expiresAt,
        status:       'pending',
        payment_instructions: `Send ${amountCrypto.toFixed(8)} ${coin} to ${address}. Payment expires in 1 hour.`,
      });
    },
  );

  // ── Get invoice ───────────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (req, reply) => {
      const db = getDb();
      const result = await db.query(
        `SELECT id, merchant_id, address, coin, amount_usd, amount_crypto, status,
                tx_id, received_at, confirmed_at, expires_at, created_at
           FROM crypto_invoices WHERE id = $1`,
        [req.params.id],
      );
      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'Invoice not found' });
        return;
      }
      reply.send(result.rows[0]);
    },
  );

  // ── List invoices ─────────────────────────────────────────────────────────
  app.get<{ Querystring: { merchant_id: string; limit?: string; coin?: string } }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['merchant_id'],
          properties: {
            merchant_id: { type: 'string' },
            limit:       { type: 'string' },
            coin:        { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const db    = getDb();
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
      const params: unknown[] = [req.query.merchant_id, limit];
      let sql = `SELECT id, address, coin, amount_usd, amount_crypto, status, created_at
                   FROM crypto_invoices WHERE merchant_id = $1`;
      if (req.query.coin) {
        sql += ` AND coin = $3`;
        params.push(req.query.coin.toUpperCase());
      }
      sql += ` ORDER BY created_at DESC LIMIT $2`;
      const result = await db.query(sql, params);
      reply.send({ data: result.rows });
    },
  );
}

// Generate a placeholder address for the given coin type.
// Production: use BIP32 HD derivation from a hardware wallet or KMS-backed key.
function generateAddress(coin: SupportedCoin): string {
  const rand = randomUUID().replace(/-/g, '');
  switch (coin) {
    case 'BTC': return `bc1q${rand.slice(0, 32)}`;
    case 'ETH': return `0x${rand.slice(0, 40)}`;
    case 'LTC': return `ltc1q${rand.slice(0, 30)}`;
    case 'XMR': return `4${rand}${rand.slice(0, 10)}`.slice(0, 95);
    default: return rand;
  }
}
