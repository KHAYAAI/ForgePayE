/**
 * Shielded stablecoin deposits — privacy-preserving USDC/USDT payments.
 *
 * Unlike regular deposits (where the plaintext amount is stored), shielded
 * deposits hide the amount in a ZK proof. Only the auditor (holding the
 * ECDH secret key) can decrypt the memo to learn the amount. The merchant
 * and the public ledger see nothing but the nullifier and proof.
 *
 * Privacy model:
 *   Customer  → knows amount, proof, blind factor
 *   Merchant  → sees only: deposit ID, nullifier, proof hash, chain, token
 *   Auditor   → decrypts encrypted_memo to know amount (for tax)
 *   Public    → sees: nullifier spent on NullifierRegistry (no amount)
 *
 * STUB MODE: All cryptographic steps (Groth16 verify, ECDH decrypt) are
 * stubbed. Real integration requires auditable-privacy-payment production lib.
 *
 * POST /shielded-deposits        — create shielded deposit
 * GET  /shielded-deposits/:id    — retrieve shielded deposit status
 * GET  /shielded-deposits        — list by merchant (no plaintext amounts)
 */

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { getDb } from '../lib/db.js';
import { config } from '../config.js';
import { forwardToUnifiedRouter } from '../lib/events.js';

interface CreateShieldedDepositBody {
  merchant_id:    string;
  encrypted_memo: string;   // base64 ECDH+AES-GCM encrypted ShieldedTxData
  proof_bytes:    string;   // base64 Groth16 proof (deposit circuit)
  nullifier:      string;   // hex nullifier (unique per UTXO spender)
  chain:          'ethereum' | 'polygon' | 'base' | 'arbitrum';
  token:          'USDC' | 'USDT';
  metadata?:      Record<string, string>;
}

// ── Stub: calls auditor service to decrypt encrypted memo ─────────────────────
// When auditable-privacy-payment is integrated, this will POST to the MoR
// auditor endpoint which uses ECDH + AES-GCM to reveal amount to MoR only.
async function decryptMemoViaAuditor(
  encryptedMemo: string,
): Promise<{ amount_units: string; amount_usd: number }> {
  // TODO: Replace with real call to auditor service
  // POST config.shielded.auditorServiceUrl + '/v1/auditor/decrypt'
  // Body: { encrypted_memo: encryptedMemo }
  // Response: { asset, amount, owner_pk, nullifier, commitment, merchant_id }
  console.warn('⚠️  STUB: decryptMemoViaAuditor — returning dummy amount; integrate auditor service');
  return {
    amount_units: '4999000',  // 4.999 USDC units (6 decimals)
    amount_usd:   4.999,
  };
}

// ── Stub: verifies Groth16 deposit proof ──────────────────────────────────────
// When auditable-privacy-payment is integrated, this calls NullifierRegistry
// via ethers.js to verify the proof on-chain (or verify locally using snarkjs).
async function verifyGroth16Proof(
  _proofBytes: string,
  _nullifier:  string,
  _chain:      string,
): Promise<boolean> {
  // TODO: Replace with real on-chain verification
  // const registry = new ethers.Contract(contractAddress, REGISTRY_ABI, provider);
  // return await registry.verifyProof(proofBytes, nullifier);
  console.warn('⚠️  STUB: verifyGroth16Proof — returning true; integrate NullifierRegistry contract');
  return true;
}

export async function buildShieldedDepositRoutes(app: FastifyInstance) {
  // ── Create shielded deposit ───────────────────────────────────────────────
  app.post<{ Body: CreateShieldedDepositBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['merchant_id', 'encrypted_memo', 'proof_bytes', 'nullifier', 'chain', 'token'],
          properties: {
            merchant_id:    { type: 'string' },
            encrypted_memo: { type: 'string' },
            proof_bytes:    { type: 'string' },
            nullifier:      { type: 'string', pattern: '^0x[0-9a-fA-F]{64}$' },
            chain:          { type: 'string', enum: ['ethereum', 'polygon', 'base', 'arbitrum'] },
            token:          { type: 'string', enum: ['USDC', 'USDT'] },
            metadata:       { type: 'object' },
          },
        },
      },
    },
    async (req, reply) => {
      const { merchant_id, encrypted_memo, proof_bytes, nullifier, chain, token, metadata } = req.body;

      const db = getDb();

      // ── 1. Check nullifier not already spent ────────────────────────────
      const existing = await db.query(
        `SELECT id, status FROM shielded_deposits WHERE nullifier = $1 LIMIT 1`,
        [nullifier],
      );
      if (existing.rows.length > 0) {
        reply.code(409).send({
          error:   'NullifierAlreadySpent',
          message: 'This nullifier has already been submitted. Double-spend prevented.',
        });
        return;
      }

      // ── 2. Verify Groth16 proof (STUB: always passes) ───────────────────
      const proofValid = await verifyGroth16Proof(proof_bytes, nullifier, chain);
      if (!proofValid) {
        reply.code(422).send({
          error:   'ProofVerificationFailed',
          message: 'Groth16 proof verification failed. Ensure the proof was generated for the correct Merkle root.',
        });
        return;
      }

      // ── 3. Decrypt memo via auditor (STUB: returns dummy amount) ─────────
      // The auditor decrypts the memo; the decrypted amount stays in the
      // MoR layer only and is never returned to the merchant caller.
      let _decrypted: { amount_units: string; amount_usd: number };
      try {
        _decrypted = await decryptMemoViaAuditor(encrypted_memo);
      } catch (err) {
        reply.code(502).send({
          error:   'AuditorUnavailable',
          message: 'Auditor service failed to decrypt memo. Retry later.',
        });
        return;
      }

      // ── 4. Persist shielded deposit (NO plaintext amount stored) ─────────
      const depositId = randomUUID();
      const expiresAt = new Date(Date.now() + config.paymentExpirySeconds * 1000).toISOString();

      await db.query(
        `INSERT INTO shielded_deposits
           (id, merchant_id, nullifier, encrypted_memo, proof_bytes, chain, token,
            status, expires_at, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,now())`,
        [
          depositId,
          merchant_id,
          nullifier,
          encrypted_memo,
          proof_bytes,
          chain,
          token,
          expiresAt,
          metadata ? JSON.stringify(metadata) : null,
        ],
      );

      // ── 5. Forward shielded.deposit.created event to unified-router ──────
      await forwardToUnifiedRouter({
        eventId:    randomUUID(),
        type:       'shielded.deposit.created',
        merchantId: merchant_id,
        depositId,
        chain,
        token,
        nullifier,
        occurredAt: new Date().toISOString(),
      } as any);

      // Privacy: response intentionally omits amount — merchant cannot infer it
      reply.code(201).send({
        id:         depositId,
        chain,
        token,
        nullifier,
        status:     'pending',
        expires_at: expiresAt,
        // No amount_usd, no amount_units — merchant must not see plaintext
        message: 'Shielded deposit created. Amount hidden. Waiting for on-chain NullifierRegistry confirmation.',
      });
    },
  );

  // ── Get shielded deposit status ───────────────────────────────────────────
  app.get<{ Params: { id: string } }>(
    '/:id',
    async (req, reply) => {
      const db = getDb();
      const result = await db.query(
        `SELECT id, merchant_id, nullifier, chain, token, status,
                tx_hash, expires_at, created_at, confirmed_at, frozen_reason
           FROM shielded_deposits WHERE id = $1`,
        [req.params.id],
      );
      if (result.rows.length === 0) {
        reply.code(404).send({ error: 'ShieldedDeposit not found' });
        return;
      }
      // Never return encrypted_memo or proof_bytes to merchant
      reply.send(result.rows[0]);
    },
  );

  // ── List shielded deposits for merchant ───────────────────────────────────
  app.get<{ Querystring: { merchant_id: string; limit?: string; status?: string } }>(
    '/',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['merchant_id'],
          properties: {
            merchant_id: { type: 'string' },
            limit:       { type: 'string' },
            status:      { type: 'string', enum: ['pending', 'confirming', 'confirmed', 'failed', 'frozen'] },
          },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const limit  = Math.min(parseInt(req.query.limit ?? '50', 10), 200);
      const params: unknown[] = [req.query.merchant_id];
      let statusClause = '';
      if (req.query.status) {
        params.push(req.query.status);
        statusClause = `AND status = $${params.length}`;
      }
      const result = await db.query(
        `SELECT id, nullifier, chain, token, status, tx_hash, created_at, confirmed_at
           FROM shielded_deposits
          WHERE merchant_id = $1 ${statusClause}
          ORDER BY created_at DESC
          LIMIT $${params.length + 1}`,
        [...params, limit],
      );
      // No encrypted_memo, no amount — merchant sees only status
      reply.send({ data: result.rows });
    },
  );
}
