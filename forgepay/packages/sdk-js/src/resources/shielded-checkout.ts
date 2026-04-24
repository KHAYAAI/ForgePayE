/**
 * Shielded Checkout Resource — Privacy-preserving payment checkout
 *
 * ARCH: Creates shielded checkout sessions where the merchant never sees
 * plaintext transaction amounts. Only the auditor (with the decryption key)
 * can decrypt the transaction to compute taxes.
 *
 * Usage:
 *   ```ts
 *   import { ForgePay } from '@forgepay/sdk';
 *
 *   const fp = new ForgePay({ apiKey: process.env.FORGEPAY_API_KEY! });
 *
 *   // Generate proof for $49.00 USDC deposit
 *   const deposit = await fp.proofs.generateDepositProof({
 *     asset: 0,
 *     amountUsd: 49.00,
 *   });
 *
 *   // Encrypt the transaction (TODO: real ECDH + AES-GCM)
 *   const memo = encryptMemo(deposit);
 *
 *   // Create shielded checkout session
 *   const session = await fp.shieldedCheckout.create({
 *     merchant_id: 'merch_123',
 *     encrypted_memo: memo,
 *     audit_proof: deposit.proof,
 *     success_url: 'https://example.com/success',
 *     cancel_url: 'https://example.com/cancel',
 *   });
 *
 *   // Redirect to Hyperswitch hosted checkout
 *   window.location.href = session.client_secret;
 *   ```
 *
 * Privacy guarantee:
 *   - Merchant never sees plaintext amount
 *   - Public ledger never sees plaintext
 *   - Only auditor (with decryption key) can compute taxes
 *   - Nullifier stored for compliance (prevent double-spending)
 */

import type { FPHttpClient } from '../client.js';

export interface ShieldedCheckoutSessionCreateParams {
  merchant_id: string;
  customer_id?: string;
  customer_email?: string;
  /// Base64-encoded encrypted memo (ECDH + AES-GCM)
  encrypted_memo: string;
  /// Base64-encoded Groth16 audit proof (optional in Phase 2)
  audit_proof?: string;
  currency?: string;
  payment_methods?: string[];
  success_url: string;
  cancel_url?: string;
  idempotency_key?: string;
  metadata?: Record<string, string>;
  /// Tax jurisdiction for computation
  customer_country?: string;
  customer_state?: string;
  customer_postal_code?: string;
}

export interface ShieldedCheckoutSessionResponse {
  session_id: string;
  status: 'pending' | 'completed' | 'failed' | 'expired';
  payment_id: string;
  client_secret: string;
  publishable_key: string;
  /// Decrypted by auditor only; merchant sees encrypted_memo instead
  amount_subtotal: number;  // Smallest unit (cents)
  amount_tax: number;
  amount_total: number;
  currency: string;
  tax_breakdown: Array<{
    jurisdiction: string;
    tax_type: string;
    rate: number;
    amount: number;
  }>;
  expires_at: string;
  success_url: string;
  cancel_url?: string;
}

/**
 * ShieldedCheckoutResource — Create privacy-preserving checkout sessions.
 *
 * The merchant MoR layer endpoint POST /v1/checkout/sessions/shielded:
 *   1. Receives encrypted_memo + audit_proof
 *   2. Verifies Groth16 proof (proof is valid)
 *   3. Decrypts memo via AuditorClient (reveal amount to auditor only)
 *   4. Computes tax on decrypted amount
 *   5. Creates Hyperswitch payment intent
 *   6. Returns session with client_secret (no plaintext to merchant)
 *
 * STUB: createShielded() creates regular checkout (no encryption / decryption yet).
 * TODO: When real ECDH + AES-GCM is integrated, this will send encrypted data.
 */
export class ShieldedCheckoutResource {
  constructor(private client: FPHttpClient) {}

  /**
   * Create a shielded checkout session.
   *
   * Submits encrypted transaction + proof to the MoR layer endpoint
   * POST /v1/checkout/sessions/shielded
   *
   * The merchant never sees the plaintext amount.
   *
   * STUB: Forwards to regular checkout (no encryption).
   * TODO: Implement real ECDH + AES-GCM encryption of the memo.
   */
  async create(params: ShieldedCheckoutSessionCreateParams): Promise<ShieldedCheckoutSessionResponse> {
    console.warn('⚠️  STUB: ShieldedCheckoutResource.create — forwarding to /v1/checkout/sessions/shielded. Encryption not integrated.');

    // Forward to backend endpoint
    const response = await this.client.request('POST', '/v1/checkout/sessions/shielded', {
      merchant_id: params.merchant_id,
      customer_id: params.customer_id,
      customer_email: params.customer_email,
      encrypted_memo: params.encrypted_memo,
      audit_proof: params.audit_proof,
      currency: params.currency || 'USD',
      payment_methods: params.payment_methods || ['card'],
      success_url: params.success_url,
      cancel_url: params.cancel_url,
      idempotency_key: params.idempotency_key,
      metadata: params.metadata || {},
      customer_country: params.customer_country,
      customer_state: params.customer_state,
      customer_postal_code: params.customer_postal_code,
    });

    return response as ShieldedCheckoutSessionResponse;
  }

  /**
   * Retrieve a shielded checkout session by ID.
   *
   * @param sessionId The session ID (format: cs_xxx)
   * @returns Session details with current payment status
   *
   * NOTE: Response does not include plaintext amount (encrypted in memo).
   * Merchant must trust the amount in the initial checkout response.
   */
  async retrieve(sessionId: string): Promise<ShieldedCheckoutSessionResponse> {
    const response = await this.client.request('GET', `/v1/checkout/sessions/${sessionId}`);
    return response as ShieldedCheckoutSessionResponse;
  }

  /**
   * List shielded checkout sessions for the current merchant.
   *
   * STUB: Not implemented yet.
   * TODO: Add pagination and filtering.
   */
  async list(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{
    data: ShieldedCheckoutSessionResponse[];
    total: number;
  }> {
    console.warn('⚠️  STUB: ShieldedCheckoutResource.list — not yet implemented.');
    return { data: [], total: 0 };
  }

  /**
   * Encrypt a transaction memo for shielded submission.
   *
   * Uses auditor's public key to encrypt the memo so that only the auditor
   * (with the secret key) can decrypt it.
   *
   * Encryption: ECDH + AES-256-GCM
   *   1. Generate ephemeral keypair
   *   2. Compute shared secret = auditor_pk * ephemeral_sk
   *   3. Derive AES key via Poseidon hash
   *   4. Encrypt plaintext JSON via AES-GCM
   *   5. Return: ephemeral_pk || ciphertext || auth_tag
   *
   * STUB: Returns plaintext (no encryption).
   * TODO: Implement real ECDH + AES-GCM encryption.
   */
  async encryptMemo(
    plaintext: Record<string, any>,
    auditorPublicKeyHex: string,
  ): Promise<string> {
    console.warn('⚠️  STUB: ShieldedCheckoutResource.encryptMemo — returning plaintext (no encryption). Real ECDH + AES-GCM not integrated.');

    const json = JSON.stringify(plaintext);
    // STUB: Return base64 of plaintext (for testing)
    return Buffer.from(json).toString('base64');
  }

  /**
   * Decrypt a shielded memo (auditor-only operation).
   *
   * IMPORTANT: This should NEVER be called on the frontend.
   * Only the auditor service (with secret key) should decrypt.
   *
   * STUB: Decodes base64 (no real decryption).
   * TODO: Implement real ECDH + AES-GCM decryption (backend only).
   */
  async decryptMemo(
    encryptedMemoBase64: string,
    auditorSecretKeyHex: string,
  ): Promise<Record<string, any>> {
    console.warn('⚠️  WARNING: ShieldedCheckoutResource.decryptMemo called on frontend. This should only be called on the backend!');

    const json = Buffer.from(encryptedMemoBase64, 'base64').toString('utf-8');
    return JSON.parse(json);
  }
}
