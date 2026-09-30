/**
 * x402 AI/agent payment protocol.
 *
 * x402 lets an agent or service pay for access with a stablecoin — USDC, USDT, ZARP
 * (rand) or OUSD. The flow:
 *   1. GET /x402/payment-required lists what will be accepted and the price in each
 *   2. The payer calls POST /x402/pay, naming an asset, and gets a one-time address,
 *      the exact amount in that asset, and (for ZARP) the rate that was locked
 *   3. The payer sends exactly that asset to that address
 *   4. The settlement loop (lib/settlement.ts) sees the transfer, waits for it to
 *      be final, and marks the receipt confirmed
 *   5. The resource server calls GET /x402/verify/:receipt to learn it is
 *
 * Amounts are held in USD, the caller's unit of account; the asset amount is
 * derived from it once, when the payment is opened, and never recomputed.
 *
 * See: https://x402.org
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { config } from '../config.js';
import { merchantAccessError } from '../plugins/api-key-auth.js';
import { ASSET_SYMBOLS } from '../lib/assets.js';
import { gatewayContext } from '../lib/context.js';
import { openDeposit, quoteAmount, AssetUnavailableError } from '../lib/deposit-open.js';
import { RateUnavailableError } from '../lib/fx.js';

interface X402PayBody {
  resource_url:  string;
  merchant_id:   string;
  agent_id?:     string;
  /** USD value to pay. `amount_usdc` is the older name for the same thing. */
  amount_usd?:   number;
  amount_usdc?:  number;
  /** Which asset to pay in. Default USDC. */
  asset?:        string;
  chain?:        string;
}

const DEFAULT_CHAIN = 'base';
const X402_TTL_SECONDS = 300;

export async function buildX402Routes(app: FastifyInstance) {
  // ── What is accepted, and for how much (returns 402) ──────────────────────
  app.get<{ Querystring: { resource?: string; merchant_id?: string; amount?: string; chain?: string } }>(
    '/payment-required',
    async (req, reply) => {
      const amountUsd = parseFloat(req.query.amount ?? '0.01');
      if (!(amountUsd > 0) || amountUsd > config.x402.maxAmountUsdc) {
        reply.code(400).send({ error: `Amount must be between 0 and the x402 max ($${config.x402.maxAmountUsdc})` });
        return;
      }
      const chain = req.query.chain ?? DEFAULT_CHAIN;
      const ctx = await gatewayContext();
      const accepts = [];
      for (const asset of ctx.registry.available().filter((a) => a.chain === chain)) {
        try {
          const q = await quoteAmount(ctx.registry, ctx.rates, asset.symbol, chain, amountUsd, 'ceil');
          accepts.push({
            scheme:   'exact',
            network:  `${chain}-mainnet`,
            maxAmountRequired: q.units.toString(),
            resource: req.query.resource ?? '*',
            description: 'ForgePay API access',
            mimeType: 'application/json',
            // Each payment gets its own address; POST /x402/pay returns it.
            payTo: null,
            payToVia: 'POST /x402/pay',
            maxTimeoutSeconds: X402_TTL_SECONDS,
            asset: asset.address,
            extra: { symbol: asset.symbol, name: asset.name, decimals: asset.decimals, unit: asset.unit, amountAsset: q.amountAsset, fxRate: q.quote.rate },
          });
        } catch { /* an asset that can't be priced right now isn't offered */ }
      }
      reply.code(402).send({ x402Version: 1, accepts });
    },
  );

  // ── Open an x402 payment ──────────────────────────────────────────────────
  app.post<{ Body: X402PayBody }>(
    '/pay',
    {
      schema: {
        body: {
          type: 'object',
          required: ['resource_url', 'merchant_id'],
          properties: {
            resource_url: { type: 'string' },
            merchant_id:  { type: 'string' },
            agent_id:     { type: 'string' },
            amount_usd:   { type: 'number', minimum: 0.001 },
            amount_usdc:  { type: 'number', minimum: 0.001 },
            asset:        { type: 'string', enum: [...ASSET_SYMBOLS] },
            chain:        { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { resource_url, merchant_id, agent_id } = req.body;
      const amountUsd = req.body.amount_usd ?? req.body.amount_usdc;
      const symbol = req.body.asset ?? 'USDC';
      const chain = req.body.chain ?? DEFAULT_CHAIN;

      // A merchant key may only create x402 payments attributed to itself.
      const ownershipError = merchantAccessError(req.auth, merchant_id);
      if (ownershipError) { reply.code(403).send(ownershipError); return; }

      if (amountUsd === undefined) {
        reply.code(400).send({ error: 'ValidationError', field: 'amount_usd', message: 'amount_usd is required' });
        return;
      }
      if (amountUsd > config.x402.maxAmountUsdc) {
        reply.code(400).send({ error: `Amount exceeds x402 max ($${config.x402.maxAmountUsdc})` });
        return;
      }

      const ctx = await gatewayContext();
      const receiptId = randomUUID();
      const client = await getDb().connect();
      try {
        await client.query('BEGIN');
        const opened = await openDeposit(client, ctx.registry, ctx.rates, {
          merchantId: merchant_id, symbol, chain, amountUsd, ttlSeconds: X402_TTL_SECONDS,
          paymentId: receiptId, metadata: { x402: true, resource_url },
        }, () => ctx.currentBlock(chain));
        const { quoted } = opened;
        await client.query(
          `INSERT INTO x402_payments
             (id, deposit_id, merchant_id, agent_id, resource_url, amount_usdc, amount_usd, amount_units, decimals,
              chain, token, asset, fx_rate, fx_pair, fx_as_of, pay_to, status, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$10,$11,$12,$13,$14,'pending',$15,now())`,
          [receiptId, opened.id, merchant_id, agent_id ?? null, resource_url, amountUsd, quoted.units.toString(),
           quoted.asset.decimals, chain, quoted.asset.symbol, quoted.quote.rate, quoted.quote.pair, quoted.quote.asOf,
           opened.address, opened.expiresAt],
        );
        await client.query('COMMIT');

        reply.code(201).send({
          receipt_id:   receiptId,
          deposit_id:   opened.id,
          pay_to:       opened.address,
          asset: {
            symbol: quoted.asset.symbol, chain, contract: quoted.asset.address,
            decimals: quoted.asset.decimals, unit: quoted.asset.unit,
          },
          amount_usd:   amountUsd,
          amount_asset: quoted.amountAsset,
          amount_units: quoted.units.toString(),
          fx: { pair: quoted.quote.pair, rate: quoted.quote.rate, as_of: quoted.quote.asOf, source: quoted.quote.source },
          expires_at:   opened.expiresAt,
          status:       'pending',
          instructions: `Send exactly ${quoted.amountAsset} ${quoted.asset.symbol} on ${chain} to ${opened.address} before ${opened.expiresAt}.`,
          // Older callers read these names:
          amount_usdc:  amountUsd,
          chain,
          token:        quoted.asset.symbol,
        });
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        if (err instanceof AssetUnavailableError || err instanceof RateUnavailableError) {
          reply.code(503).send({ error: err instanceof RateUnavailableError ? 'RateUnavailable' : 'AssetUnavailable', message: err.message });
          return;
        }
        if (err instanceof RangeError) {
          reply.code(400).send({ error: 'ValidationError', field: 'amount_usd', message: err.message });
          return;
        }
        throw err;
      } finally {
        client.release();
      }
    },
  );

  // ── Verify an x402 receipt ────────────────────────────────────────────────
  app.get<{ Params: { receipt_id: string } }>(
    '/verify/:receipt_id',
    async (req, reply) => {
      const result = await getDb().query(
        `SELECT id, merchant_id, status, amount_usd, amount_usdc, asset, chain, decimals, amount_units, received_units,
                fx_rate, fx_pair, pay_to, tx_hash, resource_url, created_at, expires_at, confirmed_at
           FROM x402_payments WHERE id = $1`,
        [req.params.receipt_id],
      );
      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'Receipt not found' });
        return;
      }
      const payment = result.rows[0] as { merchant_id: string; status: string; amount_usd: string | null; amount_usdc: string };

      // IDOR guard — only the owning merchant (or admin) may verify a receipt.
      const ownershipError = merchantAccessError(req.auth, payment.merchant_id);
      if (ownershipError) { reply.code(403).send(ownershipError); return; }

      const { merchant_id: _merchantId, ...publicPayment } = payment as Record<string, unknown>;
      reply.send({
        ...publicPayment,
        amount_usd: Number(payment.amount_usd ?? payment.amount_usdc),
        // A payment that confirmed stays valid: the payer sent it in time, and the
        // receipt's short life applies to *paying*, not to being recognised afterwards.
        valid: payment.status === 'confirmed',
      });
    },
  );

  // ── Shielded x402 routes ─────────────────────────────────────────────────
  // POST /x402/shielded-pay and GET /x402/shielded-verify/:receipt_id are
  // implemented with full proof verification in routes/x402-shielded.ts and
  // registered from index.ts. The shielded-payment-required discovery endpoint
  // below returns the 402 challenge; the actual payment submission goes to the
  // dedicated x402-shielded router.
  //
  // GET /x402/shielded-payment-required — returns 402 challenge with ZK params.
  // STUB: auditor_public_key and contract_address populated once Phase 3
  // contracts are deployed to testnets.
  app.get<{ Querystring: { resource?: string; merchant_id?: string } }>(
    '/shielded-payment-required',
    async (req, reply) => {
      reply.code(402).send({
        x402Version:  1,
        scheme:       'x402-shielded',
        network:      'base-mainnet',
        resource:     req.query.resource ?? '*',
        description:  'ForgePay shielded API access (ZK privacy)',
        mimeType:     'application/json',
        maxTimeoutSeconds: 300,
        shielded: {
          // TODO: Load auditor_public_key from AuditorClient.public_key() after Phase 3
          auditor_public_key: '0x0000000000000000000000000000000000000000000000000000000000000000',
          // TODO: Populate after Phase 3 contract deployment
          contract_address:   '0x0000000000000000000000000000000000000000',
          chain:              'base',
          token:              'USDC',
          // Agent must generate: encrypted_memo + proof_bytes + nullifier
          // then POST to /x402/shielded-pay
          proof_circuit:      'deposit-v1',
        },
        extra: {
          privacy_level: 'shielded',
          version:       '1.0.0',
        },
      });
    },
  );
}
