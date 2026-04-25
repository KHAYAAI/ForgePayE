/**
 * x402 shielded payment route — privacy-preserving AI agent payments.
 *
 * AI agents can pay for API resource access without revealing their payment
 * amount to the resource server. The agent generates a Groth16 ZK proof
 * client-side and submits an ECDH-encrypted memo; the resource server only
 * ever sees a nullifier and a boolean "valid" signal.
 *
 * Privacy model (same as shielded-deposits, applied to x402 flow):
 *   Agent         → knows amount, proof, blind factor
 *   Resource srv  → sees only: receipt_id, nullifier, valid bool, resource_url
 *   Auditor       → decrypts encrypted_memo to know amount (for MoR tax)
 *   Public ledger → sees: nullifier spent on NullifierRegistry (no amount)
 *
 * Routes registered at prefix /x402 (alongside regular x402 routes):
 *   POST /shielded-pay            — agent submits ZK proof + encrypted_memo
 *   GET  /shielded-verify/:id     — resource server checks payment validity
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { decryptMemoViaAuditor, verifyGroth16Proof } from '../lib/proof-verifier.js';

// Supported chains for shielded x402 — Base is the default (low fees for agents)
type ShieldedChain = 'base' | 'ethereum' | 'polygon' | 'arbitrum';

interface X402ShieldedPayBody {
  resource_url:   string;
  merchant_id:    string;
  encrypted_memo: string;   // base64 ECDH+AES-GCM encrypted ShieldedTxData
  proof_bytes:    string;   // base64 Groth16 deposit proof
  nullifier:      string;   // hex bytes32 nullifier (0x-prefixed)
  chain:          ShieldedChain;
  agent_id?:      string;   // optional: opaque identifier of the paying agent
}

export async function buildX402ShieldedRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /x402/shielded-pay ────────────────────────────────────────────────
  //
  // Agent submits shielded proof + encrypted_memo + nullifier.
  // Steps:
  //   1. Nullifier double-spend check (DB)
  //   2. Groth16 proof verification via NullifierRegistry (or dev bypass)
  //   3. Memo decryption via auditor to retrieve amount
  //   4. Store in x402_shielded_payments; return receipt_id
  //
  // Amount is intentionally never returned — resource server must not learn it.
  app.post<{ Body: X402ShieldedPayBody }>(
    '/shielded-pay',
    {
      schema: {
        body: {
          type: 'object',
          required: [
            'resource_url', 'merchant_id',
            'encrypted_memo', 'proof_bytes', 'nullifier', 'chain',
          ],
          properties: {
            resource_url:   { type: 'string', minLength: 1 },
            merchant_id:    { type: 'string', minLength: 1 },
            encrypted_memo: { type: 'string', minLength: 1 },
            proof_bytes:    { type: 'string', minLength: 1 },
            nullifier:      { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
            chain:          { type: 'string', enum: ['base', 'ethereum', 'polygon', 'arbitrum'] },
            agent_id:       { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const {
        resource_url, merchant_id,
        encrypted_memo, proof_bytes, nullifier,
        chain, agent_id,
      } = req.body;

      const db = getDb();

      // ── 1. Nullifier double-spend check ──────────────────────────────────────
      const spent = await db.query(
        `SELECT id FROM x402_shielded_payments WHERE nullifier = $1 LIMIT 1`,
        [nullifier],
      );
      if (spent.rows.length > 0) {
        reply.code(409).send({
          error:   'NullifierAlreadySpent',
          message: 'This nullifier has already been used for an x402 shielded payment.',
        });
        return;
      }

      // Also check shielded_deposits to prevent cross-table nullifier reuse
      const spentInDeposits = await db.query(
        `SELECT id FROM shielded_deposits WHERE nullifier = $1 LIMIT 1`,
        [nullifier],
      );
      if (spentInDeposits.rows.length > 0) {
        reply.code(409).send({
          error:   'NullifierAlreadySpent',
          message: 'This nullifier has already been used in a shielded deposit.',
        });
        return;
      }

      // ── 2. Verify Groth16 proof via NullifierRegistry ─────────────────────
      let proofValid: boolean;
      try {
        proofValid = await verifyGroth16Proof(proof_bytes, nullifier, chain);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply.code(502).send({
          error:   'ProofVerificationError',
          message: `Proof verification failed: ${msg}`,
        });
        return;
      }

      if (!proofValid) {
        reply.code(422).send({
          error:   'ProofVerificationFailed',
          message: 'Groth16 proof verification failed or nullifier is already spent on-chain.',
        });
        return;
      }

      // ── 3. Decrypt memo via auditor (amount stays in auditor / MoR only) ───
      // We call the auditor to validate the memo is well-formed, but we do NOT
      // store or return the amount — it must remain hidden from the resource server.
      try {
        await decryptMemoViaAuditor(encrypted_memo);
        // Intentionally discard the decrypted amount here — we only needed to
        // confirm the memo is valid and the auditor can read it.
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reply.code(502).send({
          error:   'AuditorUnavailable',
          message: `Auditor service failed to decrypt memo: ${msg}`,
        });
        return;
      }

      // ── 4. Persist x402 shielded payment ────────────────────────────────────
      const receiptId = randomUUID();
      const expiresAt = new Date(Date.now() + 300_000).toISOString(); // 5 min

      await db.query(
        `INSERT INTO x402_shielded_payments
           (id, merchant_id, agent_id, resource_url, nullifier, encrypted_memo,
            proof_bytes, chain, token, status, expires_at, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'USDC','pending',$9,now())`,
        [
          receiptId,
          merchant_id,
          agent_id ?? null,
          resource_url,
          nullifier,
          encrypted_memo,
          proof_bytes,
          chain,
          expiresAt,
        ],
      );

      // Privacy: response exposes only the receipt_id and nullifier.
      // No amount_usd, no amount_units — resource server cannot infer value.
      reply.code(201).send({
        receipt_id:  receiptId,
        nullifier,
        chain,
        token:       'USDC',
        status:      'pending',
        expires_at:  expiresAt,
      });
    },
  );

  // ── GET /x402/shielded-verify/:receipt_id ──────────────────────────────────
  //
  // Resource server verifies whether an x402 shielded payment is valid.
  // Returns: { valid, resource_url, agent_id }
  // NEVER returns: amount, encrypted_memo, proof_bytes (privacy preserved).
  app.get<{ Params: { receipt_id: string } }>(
    '/shielded-verify/:receipt_id',
    async (req, reply) => {
      const db = getDb();
      const result = await db.query(
        // Intentionally select only non-sensitive columns
        `SELECT id, status, chain, resource_url, nullifier,
                agent_id, created_at, expires_at
           FROM x402_shielded_payments
          WHERE id = $1`,
        [req.params.receipt_id],
      );

      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'Shielded receipt not found' });
        return;
      }

      const payment = result.rows[0] as {
        id:           string;
        status:       string;
        chain:        string;
        resource_url: string;
        nullifier:    string;
        agent_id:     string | null;
        created_at:   string;
        expires_at:   string;
      };

      // Payment is valid only when confirmed on-chain and not expired
      const valid = payment.status === 'confirmed'
        && new Date(payment.expires_at) > new Date();

      // Return only the information the resource server legitimately needs.
      // agent_id is included so the resource server can scope access, but
      // the payment amount is never disclosed.
      reply.send({
        valid,
        shielded:     true,
        receipt_id:   payment.id,
        resource_url: payment.resource_url,
        agent_id:     payment.agent_id,
        chain:        payment.chain,
        status:       payment.status,
        // No amount_usdc, no amount_units — shielded payment hides the amount
      });
    },
  );
}
