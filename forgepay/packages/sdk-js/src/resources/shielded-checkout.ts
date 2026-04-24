/**
 * Shielded Checkout Resource — Privacy-preserving payment checkout
 *
 * ARCH: Creates shielded checkout sessions where the merchant never sees
 * plaintext transaction amounts. Only the auditor (with the decryption key)
 * can decrypt the transaction to compute taxes.
 *
 * Encryption: X25519 ECDH + SHA-256 KDF + AES-256-GCM (Web Crypto API)
 * Matches the wire format of the Rust auditor crate and Python auditor module.
 */

import type { FPHttpClient } from '../client.js';

// ── Types ──────────────────────────────────────────────────────────────────

export interface ShieldedCheckoutSessionCreateParams {
  merchant_id: string;
  customer_id?: string;
  customer_email?: string;
  /** Base64-encoded JSON EncryptedMemo (ephemeral_pk + nonce + ciphertext + auth_tag) */
  encrypted_memo: string;
  /** Base64-encoded Groth16 audit proof */
  audit_proof?: string;
  currency?: string;
  payment_methods?: string[];
  success_url: string;
  cancel_url?: string;
  idempotency_key?: string;
  metadata?: Record<string, string>;
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
  amount_subtotal: number;
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

// ── Wire format for encrypted memo ─────────────────────────────────────────

interface EncryptedMemoWire {
  ephemeral_pk: string; // 32-byte X25519 ephemeral public key (hex)
  nonce: string;        // 12-byte AES-GCM nonce (hex)
  ciphertext: string;   // AES-GCM ciphertext without tag (hex)
  auth_tag: string;     // 16-byte GCM authentication tag (hex)
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string must have even length');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 of shared secret bytes → 32-byte AES key
async function deriveAesKey(sharedSecretBytes: Uint8Array): Promise<CryptoKey> {
  const hashBuf = await crypto.subtle.digest('SHA-256', sharedSecretBytes);
  return crypto.subtle.importKey(
    'raw', hashBuf, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'],
  );
}

// ── ShieldedCheckoutResource ────────────────────────────────────────────────

/**
 * ShieldedCheckoutResource — Privacy-preserving checkout using ECDH + AES-256-GCM.
 *
 * Encryption flow (browser-side):
 *   1. Generate ephemeral X25519 keypair (Web Crypto API)
 *   2. ECDH(ephemeral_sk, auditor_pk) → shared secret
 *   3. symmetric_key = SHA-256(shared_secret)
 *   4. AES-256-GCM encrypt plaintext JSON with random 12-byte nonce
 *   5. Package: { ephemeral_pk, nonce, ciphertext, auth_tag } → base64 JSON
 *
 * MoR server decrypts using the same algorithm via the Rust/Python auditor crate.
 */
export class ShieldedCheckoutResource {
  constructor(private client: FPHttpClient) {}

  /**
   * Create a shielded checkout session.
   *
   * Submits encrypted_memo + proof to POST /v1/checkout/sessions/shielded.
   * The merchant backend never sees the plaintext amount — only the auditor can decrypt.
   */
  async create(
    params: ShieldedCheckoutSessionCreateParams,
  ): Promise<ShieldedCheckoutSessionResponse> {
    const response = await this.client.request(
      'POST',
      '/v1/checkout/sessions/shielded',
      {
        merchant_id: params.merchant_id,
        customer_id: params.customer_id,
        customer_email: params.customer_email,
        encrypted_memo: params.encrypted_memo,
        audit_proof: params.audit_proof,
        currency: params.currency ?? 'USD',
        payment_methods: params.payment_methods ?? ['card'],
        success_url: params.success_url,
        cancel_url: params.cancel_url,
        idempotency_key: params.idempotency_key,
        metadata: params.metadata ?? {},
        customer_country: params.customer_country,
        customer_state: params.customer_state,
        customer_postal_code: params.customer_postal_code,
      },
    );
    return response as ShieldedCheckoutSessionResponse;
  }

  /** Retrieve a shielded checkout session by ID. */
  async retrieve(sessionId: string): Promise<ShieldedCheckoutSessionResponse> {
    const response = await this.client.request('GET', `/v1/checkout/sessions/${sessionId}`);
    return response as ShieldedCheckoutSessionResponse;
  }

  /**
   * List shielded checkout sessions for the current merchant.
   * TODO: Add server-side pagination and filtering support.
   */
  async list(params?: { limit?: number; offset?: number }): Promise<{
    data: ShieldedCheckoutSessionResponse[];
    total: number;
  }> {
    const response = await this.client.request('GET', '/v1/checkout/sessions', {
      shielded: true,
      ...params,
    });
    return response as { data: ShieldedCheckoutSessionResponse[]; total: number };
  }

  /**
   * Encrypt a transaction memo using X25519 ECDH + SHA-256 KDF + AES-256-GCM.
   *
   * This runs entirely browser-side via the Web Crypto API — no plaintext
   * leaves the client. The server only ever receives encrypted bytes.
   *
   * Wire format (base64-encoded JSON):
   * {
   *   "ephemeral_pk": "<32 bytes hex>",
   *   "nonce":        "<12 bytes hex>",
   *   "ciphertext":   "<N bytes hex>",
   *   "auth_tag":     "<16 bytes hex>"
   * }
   *
   * @param plaintext   Object to encrypt (e.g., { asset, amount, commitment })
   * @param auditorPublicKeyHex  Auditor's 32-byte X25519 public key (hex string)
   * @returns Base64-encoded JSON EncryptedMemo
   */
  async encryptMemo(
    plaintext: Record<string, unknown>,
    auditorPublicKeyHex: string,
  ): Promise<string> {
    const auditorPkBytes = hexToBytes(auditorPublicKeyHex);
    if (auditorPkBytes.length !== 32) {
      throw new Error('auditorPublicKeyHex must be 32 bytes (64 hex chars)');
    }

    // 1. Import auditor's X25519 public key
    const auditorPk = await crypto.subtle.importKey(
      'raw', auditorPkBytes, { name: 'X25519' }, false, [],
    );

    // 2. Generate ephemeral X25519 keypair
    const ephemeralKeypair = await crypto.subtle.generateKey(
      { name: 'X25519' }, true, ['deriveBits'],
    );

    // 3. ECDH → raw shared secret bits
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'X25519', public: auditorPk },
      (ephemeralKeypair as CryptoKeyPair).privateKey,
      256,
    );

    // 4. SHA-256 KDF → AES-256 key
    const aesKey = await deriveAesKey(new Uint8Array(sharedBits));

    // 5. AES-256-GCM encrypt with random 12-byte nonce
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(plaintext));
    const ciphertextWithTag = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      plaintextBytes,
    );

    // Web Crypto appends 16-byte tag at end of ciphertext
    const ctBytes = new Uint8Array(ciphertextWithTag);
    const ciphertext = ctBytes.slice(0, -16);
    const authTag = ctBytes.slice(-16);

    // 6. Export ephemeral public key (raw 32-byte X25519 point)
    const ephemeralPkRaw = await crypto.subtle.exportKey(
      'raw', (ephemeralKeypair as CryptoKeyPair).publicKey,
    );

    const wire: EncryptedMemoWire = {
      ephemeral_pk: bytesToHex(new Uint8Array(ephemeralPkRaw)),
      nonce: bytesToHex(nonce),
      ciphertext: bytesToHex(ciphertext),
      auth_tag: bytesToHex(authTag),
    };

    return btoa(JSON.stringify(wire));
  }

  /**
   * Decrypt an encrypted memo — AUDITOR-SIDE ONLY.
   *
   * WARNING: This must never be called from the browser. It is exposed here
   * only for backend testing and auditor tooling. Calling this from a browser
   * would require having the auditor's secret key in JavaScript, which defeats
   * the entire privacy model.
   *
   * @param encryptedMemoBase64  Base64 JSON from encryptMemo()
   * @param auditorSecretKeyHex  Auditor's 32-byte X25519 secret key (hex)
   */
  async decryptMemo(
    encryptedMemoBase64: string,
    auditorSecretKeyHex: string,
  ): Promise<Record<string, unknown>> {
    const wire: EncryptedMemoWire = JSON.parse(atob(encryptedMemoBase64));

    const skBytes = hexToBytes(auditorSecretKeyHex);
    if (skBytes.length !== 32) {
      throw new Error('auditorSecretKeyHex must be 32 bytes');
    }

    // Import auditor's X25519 private key
    const auditorSk = await crypto.subtle.importKey(
      'raw', skBytes, { name: 'X25519' }, false, ['deriveBits'],
    );

    // Import ephemeral public key
    const ephPkBytes = hexToBytes(wire.ephemeral_pk);
    const ephPk = await crypto.subtle.importKey(
      'raw', ephPkBytes, { name: 'X25519' }, false, [],
    );

    // ECDH → shared secret
    const sharedBits = await crypto.subtle.deriveBits(
      { name: 'X25519', public: ephPk },
      auditorSk,
      256,
    );

    // SHA-256 KDF → AES key
    const aesKey = await deriveAesKey(new Uint8Array(sharedBits));

    // AES-256-GCM decrypt (ciphertext || auth_tag)
    const nonce = hexToBytes(wire.nonce);
    const ciphertext = hexToBytes(wire.ciphertext);
    const authTag = hexToBytes(wire.auth_tag);
    const fullCiphertext = new Uint8Array(ciphertext.length + authTag.length);
    fullCiphertext.set(ciphertext);
    fullCiphertext.set(authTag, ciphertext.length);

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, tagLength: 128 },
      aesKey,
      fullCiphertext,
    );

    return JSON.parse(new TextDecoder().decode(plaintext));
  }
}
