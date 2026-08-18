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
import { encryptPrivateKey } from '../lib/keystore.js';
import { merchantAccessError } from '../plugins/api-key-auth.js';

interface CreateDepositBody {
  merchant_id:    string;
  amount_usd:     number;       // human-readable USD amount
  token:          'USDC' | 'USDT';
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
            token:       { type: 'string', enum: ['USDC', 'USDT'] },
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

      // Convert USD amount to token units (USDC/USDT both have 6 decimals)
      const amountUnits = Math.round(amount_usd * 1_000_000).toString();
      const depositId   = randomUUID();

      // Generate a fresh EVM deposit address using ethers.js HD wallet.
      // In production: use a deterministic path from a hardware wallet or KMS.
      // For now: generate a fresh random wallet per deposit (simpler, less efficient).
      const { ethers } = await import('ethers');
      const wallet     = ethers.Wallet.createRandom();
      const address    = wallet.address;
      const privateKey = wallet.privateKey;

      const expiresAt = new Date(Date.now() + config.depositAddressTtlSeconds * 1000).toISOString();

      const db = getDb();
      await db.query(
        `INSERT INTO stablecoin_deposits
           (id, merchant_id, address, private_key_enc, chain, token, amount_units,
            amount_usd, payment_id, metadata, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11,now())`,
        [
          depositId,
          merchant_id,
          address,
          encryptPrivateKey(privateKey),
          chain,
          token,
          amountUnits,
          amount_usd,
          payment_id ?? null,
          metadata ? JSON.stringify(metadata) : null,
          expiresAt,
        ],
      );

      reply.code(201).send({
        id:           depositId,
        address,
        chain,
        token,
        amount_usd,
        amount_units: amountUnits,
        expires_at:   expiresAt,
        status:       'pending',
        payment_instructions: `Send exactly ${amount_usd} ${token} to ${address} on ${chain}.`,
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
