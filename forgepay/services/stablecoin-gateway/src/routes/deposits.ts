/**
 * Stablecoin deposit management API.
 *
 * POST /deposits        — create a new deposit address for a payment
 * GET  /deposits/:id    — retrieve deposit status
 * GET  /deposits        — list deposits for a merchant
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { config } from '../config.js';
import { ASSET_SYMBOLS } from '../lib/assets.js';
import { gatewayContext } from '../lib/context.js';
import { openDeposit, AssetUnavailableError } from '../lib/deposit-open.js';
import { RateUnavailableError } from '../lib/fx.js';
import { merchantAccessError } from '../plugins/api-key-auth.js';

interface CreateDepositBody {
  merchant_id:    string;
  amount_usd:     number;       // human-readable USD amount
  token:          'USDC' | 'USDT' | 'ZARP' | 'OUSD';
  chain:          'ethereum' | 'polygon' | 'base' | 'arbitrum' | 'solana';
  payment_id?:    string;       // link to a ForgePay payment record
  metadata?:      Record<string, string>;
}

export async function buildDepositRoutes(app: FastifyInstance) {
  // ── Create deposit address ────────────────────────────────────────────────
  app.post<{ Body: CreateDepositBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['merchant_id', 'amount_usd', 'token', 'chain'],
          properties: {
            merchant_id: { type: 'string' },
            amount_usd:  { type: 'number', minimum: 0.01 },
            token:       { type: 'string', enum: [...ASSET_SYMBOLS] },
            chain:       { type: 'string', enum: ['ethereum', 'polygon', 'base', 'arbitrum', 'solana'] },
            payment_id:  { type: 'string' },
            metadata:    { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      const { merchant_id, amount_usd, token, chain, payment_id, metadata } = req.body;

      // A merchant key may only create deposits attributed to itself — without
      // this, any valid merchant key could open a deposit (and its associated
      // custodied private key) under a different merchant_id entirely.
      const ownershipError = merchantAccessError(req.auth, merchant_id);
      if (ownershipError) {
        reply.code(403).send(ownershipError);
        return;
      }

      const ctx = await gatewayContext();
      let opened;
      try {
        opened = await openDeposit(getDb(), ctx.registry, ctx.rates, {
          merchantId: merchant_id, symbol: token, chain, amountUsd: amount_usd,
          ttlSeconds: config.depositAddressTtlSeconds, paymentId: payment_id ?? null, metadata: metadata ?? null,
        }, () => ctx.currentBlock(chain));
      } catch (err) {
        if (err instanceof AssetUnavailableError || err instanceof RateUnavailableError) {
          reply.code(503).send({ error: err instanceof RateUnavailableError ? 'RateUnavailable' : 'AssetUnavailable', message: err.message });
          return;
        }
        if (err instanceof RangeError) {
          reply.code(400).send({ error: 'ValidationError', field: 'amount_usd', message: err.message });
          return;
        }
        throw err;
      }
      const { quoted } = opened;

      reply.code(201).send({
        id:           opened.id,
        address:      opened.address,
        chain,
        token:        quoted.asset.symbol,
        decimals:     quoted.asset.decimals,
        amount_usd,
        amount_asset: quoted.amountAsset,
        amount_units: quoted.units.toString(),
        expires_at:   opened.expiresAt,
        status:       'pending',
        payment_instructions: `Send exactly ${quoted.amountAsset} ${quoted.asset.symbol} to ${opened.address} on ${chain}.`,
      });
    },
  );

  // ── Get deposit status ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (req, reply) => {
      const db = getDb();
      const result = await db.query(
        `SELECT id, merchant_id, address, chain, token, amount_units, amount_usd,
                status, tx_hash, received_at, confirmed_at, expires_at, created_at
           FROM stablecoin_deposits WHERE id = $1`,
        [req.params.id],
      );
      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'Deposit not found' });
        return;
      }

      const deposit = result.rows[0] as { merchant_id: string };
      // IDOR guard: the deposit id is a UUID (not enumerable), but this is
      // defense-in-depth — without it, any valid API key could read any
      // other merchant's deposit record (amount, deposit address,
      // merchant_id) just by knowing/guessing the UUID. A mismatch is 403,
      // not 404: the caller authenticated fine, it simply doesn't own this
      // deposit.
      const ownershipError = merchantAccessError(req.auth, deposit.merchant_id);
      if (ownershipError) {
        reply.code(403).send(ownershipError);
        return;
      }

      reply.send(deposit);
    },
  );

  // ── List deposits for merchant ────────────────────────────────────────────
  app.get<{ Querystring: { merchant_id: string; limit?: string } }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['merchant_id'],
          properties: {
            merchant_id: { type: 'string' },
            limit:       { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      // A merchant key may only list its own deposits — the query string
      // alone is not a credential, so a non-admin caller is always scoped to
      // its own merchant_id regardless of what it asked for.
      const merchantId = req.auth?.kind === 'admin' ? req.query.merchant_id : req.auth?.principalId;
      if (!merchantId) {
        reply.code(401).send({ error: 'Unauthorized', message: 'Missing authentication context.' });
        return;
      }

      const db = getDb();
      const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
      const result = await db.query(
        `SELECT id, address, chain, token, amount_usd, status, tx_hash, created_at
           FROM stablecoin_deposits
          WHERE merchant_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [merchantId, limit],
      );
      reply.send({ data: result.rows });
    },
  );
}
