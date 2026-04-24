/**
 * x402 AI/agent payment protocol.
 *
 * x402 allows AI agents and automated systems to pay for API access using
 * USDC on Base (L2). The flow:
 *   1. Resource server returns HTTP 402 with a payment request
 *   2. Agent reads the payment details from the 402 response
 *   3. Agent calls POST /x402/pay to create a deposit
 *   4. Resource server verifies payment via GET /x402/verify/:receipt
 *
 * See: https://x402.org
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { config } from '../config.js';

interface X402PayBody {
  resource_url:  string;   // URL the agent wants to access
  amount_usdc:   number;   // USD amount (USDC on Base)
  merchant_id:   string;
  agent_id?:     string;   // optional: identifier of the paying agent
}

export async function buildX402Routes(app: FastifyInstance) {
  // ── Payment request for a resource (returns 402) ──────────────────────────
  app.get<{ Querystring: { resource?: string; merchant_id?: string; amount?: string } }>(
    '/payment-required',
    async (req, reply) => {
      const amountUsdc = parseFloat(req.query.amount ?? '0.01');
      if (amountUsdc > config.x402.maxAmountUsdc) {
        reply.code(400).send({ error: `Amount exceeds x402 max ($${config.x402.maxAmountUsdc})` });
        return;
      }

      reply.code(402).send({
        x402Version:  1,
        accepts: [{
          scheme:   'exact',
          network:  'base-mainnet',
          maxAmountRequired: String(Math.round(amountUsdc * 1_000_000)),
          resource: req.query.resource ?? '*',
          description: 'ForgePay API access',
          mimeType: 'application/json',
          payTo: 'fp_x402_vault',     // merchant's x402 vault address (set per merchant)
          maxTimeoutSeconds: 300,
          asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',  // USDC on Base
          extra: {
            name:    'USD Coin',
            version: '2',
          },
        }],
      });
    },
  );

  // ── Create x402 payment ───────────────────────────────────────────────────
  app.post<{ Body: X402PayBody }>(
    '/pay',
    {
      schema: {
        body: {
          type: 'object',
          required: ['resource_url', 'amount_usdc', 'merchant_id'],
          properties: {
            resource_url: { type: 'string' },
            amount_usdc:  { type: 'number', minimum: 0.001 },
            merchant_id:  { type: 'string' },
            agent_id:     { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { resource_url, amount_usdc, merchant_id, agent_id } = req.body;

      if (amount_usdc > config.x402.maxAmountUsdc) {
        reply.code(400).send({ error: `Amount exceeds x402 max ($${config.x402.maxAmountUsdc})` });
        return;
      }

      const receiptId  = randomUUID();
      const depositId  = randomUUID();
      const amountUnits = Math.round(amount_usdc * 1_000_000).toString();
      const expiresAt  = new Date(Date.now() + 300_000).toISOString(); // 5 min

      const db = getDb();
      await db.query(
        `INSERT INTO x402_payments
           (id, deposit_id, merchant_id, agent_id, resource_url, amount_usdc, amount_units,
            chain, token, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'base','USDC','pending',$8,now())`,
        [receiptId, depositId, merchant_id, agent_id ?? null, resource_url, amount_usdc, amountUnits, expiresAt],
      );

      reply.code(201).send({
        receipt_id:   receiptId,
        deposit_id:   depositId,
        amount_usdc,
        amount_units: amountUnits,
        chain:        'base',
        token:        'USDC',
        expires_at:   expiresAt,
        status:       'pending',
      });
    },
  );

  // ── Verify x402 receipt ───────────────────────────────────────────────────
  app.get<{ Params: { receipt_id: string } }>(
    '/verify/:receipt_id',
    async (req, reply) => {
      const db = getDb();
      const result = await db.query(
        `SELECT id, status, amount_usdc, chain, resource_url, created_at, expires_at
           FROM x402_payments WHERE id = $1`,
        [req.params.receipt_id],
      );
      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'Receipt not found' });
        return;
      }
      const payment = result.rows[0] as { status: string; expires_at: string };
      reply.send({
        ...payment,
        valid: payment.status === 'confirmed' && new Date(payment.expires_at) > new Date(),
      });
    },
  );

  // ── Shielded x402: payment required (returns 402 with ZK params) ─────────
  //
  // x402-shielded allows AI agents to pay for resource access without
  // revealing the payment amount to the resource server. The agent generates
  // a ZK proof client-side and submits an encrypted memo — the resource
  // server only sees a nullifier, never a plaintext amount.
  //
  // STUB: Returns a scaffold 402 response. Real integration requires:
  //   - auditor_public_key: BabyJubjub public key (from AuditorClient.public_key())
  //   - contract_address: deployed NullifierRegistry address per chain
  app.get<{ Querystring: { resource?: string; merchant_id?: string } }>(
    '/shielded-payment-required',
    async (req, reply) => {
      console.warn('⚠️  STUB: x402 shielded-payment-required — using placeholder contract addresses');

      reply.code(402).send({
        x402Version:  1,
        scheme:       'x402-shielded',
        network:      'base-mainnet',
        resource:     req.query.resource ?? '*',
        description:  'ForgePay shielded API access (ZK privacy)',
        mimeType:     'application/json',
        maxTimeoutSeconds: 300,
        // Fields specific to x402-shielded:
        shielded: {
          // Auditor's BabyJubjub public key — agent encrypts memo to this key
          // TODO: Load from AuditorClient.public_key() via auditor service
          auditor_public_key: '0x0000000000000000000000000000000000000000000000000000000000000000',
          // On-chain NullifierRegistry — agent submits proof here
          // TODO: Set after Phase 3 contract deployment
          contract_address:   '0x0000000000000000000000000000000000000000',
          chain:              'base',
          token:              'USDC',
          // Agent must generate: encrypted_memo + proof_bytes + nullifier
          // then POST to /x402/shielded-pay
          proof_circuit:      'deposit-v1',
        },
        extra: {
          privacy_level: 'shielded',
          version:       '0.1.0-stub',
        },
      });
    },
  );

  // ── Shielded x402: pay (agent submits ZK proof, no plaintext amount) ─────
  app.post<{
    Body: {
      resource_url:   string;
      merchant_id:    string;
      encrypted_memo: string;  // base64 ECDH+AES-GCM encrypted
      proof_bytes:    string;  // base64 Groth16 deposit proof
      nullifier:      string;  // hex nullifier
      agent_id?:      string;
    };
  }>(
    '/shielded-pay',
    {
      schema: {
        body: {
          type: 'object',
          required: ['resource_url', 'merchant_id', 'encrypted_memo', 'proof_bytes', 'nullifier'],
          properties: {
            resource_url:   { type: 'string' },
            merchant_id:    { type: 'string' },
            encrypted_memo: { type: 'string' },
            proof_bytes:    { type: 'string' },
            nullifier:      { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
            agent_id:       { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const { resource_url, merchant_id, encrypted_memo, proof_bytes, nullifier, agent_id } = req.body;

      const db      = getDb();
      const receiptId = randomUUID();
      const expiresAt = new Date(Date.now() + 300_000).toISOString(); // 5 min

      // Check nullifier not already used
      const spent = await db.query(
        `SELECT id FROM x402_shielded_payments WHERE nullifier = $1 LIMIT 1`,
        [nullifier],
      );
      if (spent.rows.length > 0) {
        reply.code(409).send({
          error:   'NullifierAlreadySpent',
          message: 'This nullifier was already used for an x402 shielded payment.',
        });
        return;
      }

      console.warn('⚠️  STUB: x402 shielded-pay — proof not verified; integrate NullifierRegistry');

      await db.query(
        `INSERT INTO x402_shielded_payments
           (id, merchant_id, agent_id, resource_url, nullifier, encrypted_memo,
            proof_bytes, chain, token, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'base','USDC','pending',$8,now())`,
        [receiptId, merchant_id, agent_id ?? null, resource_url, nullifier,
         encrypted_memo, proof_bytes, expiresAt],
      );

      // Privacy: receipt does not expose amount — only nullifier
      reply.code(201).send({
        receipt_id:  receiptId,
        nullifier,
        chain:       'base',
        token:       'USDC',
        status:      'pending',
        expires_at:  expiresAt,
        // No amount_usdc — shielded payment hides amount from resource server
      });
    },
  );

  // ── Shielded x402 verify ──────────────────────────────────────────────────
  app.get<{ Params: { receipt_id: string } }>(
    '/shielded-verify/:receipt_id',
    async (req, reply) => {
      const db = getDb();
      const result = await db.query(
        `SELECT id, status, chain, resource_url, nullifier, created_at, expires_at
           FROM x402_shielded_payments WHERE id = $1`,
        [req.params.receipt_id],
      );
      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'Shielded receipt not found' });
        return;
      }
      const payment = result.rows[0] as { status: string; expires_at: string };
      // No amount returned — only validity signal
      reply.send({
        ...payment,
        valid:  payment.status === 'confirmed' && new Date(payment.expires_at) > new Date(),
        shielded: true,
      });
    },
  );
}
