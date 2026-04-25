/**
 * Tests for the ShieldedCheckoutResource
 *
 * These run in Node.js — Web Crypto is available via globalThis.crypto in Node 18+.
 * Vitest provides the test environment; no mocking framework needed for crypto.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ShieldedCheckoutResource } from '../src/resources/shielded-checkout.js';

// 32-byte (64-hex-char) test auditor public key — not a real key, only used for
// exercising the ECDH path (encryption succeeds, decryption not tested here).
const TEST_AUDITOR_PK_HEX = 'a'.repeat(64);

// Minimal ForgePay SDK client mock — ShieldedCheckoutResource only calls
// this.client.request() in create/retrieve/list, not in encryptMemo/decryptMemo.
const mockClient = { apiKey: 'fp_test_key' } as any;

describe('ShieldedCheckoutResource', () => {
  let resource: ShieldedCheckoutResource;

  beforeEach(() => {
    resource = new ShieldedCheckoutResource(mockClient);
  });

  describe('encryptMemo', () => {
    it('returns a base64-encoded string', async () => {
      const memo = { asset: 0, amount: 1_000_000, merchant_id: 'merch_123' };
      const enc = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);
      expect(typeof enc).toBe('string');
      // Should be valid base64 — atob should not throw
      expect(() => atob(enc)).not.toThrow();
    });

    it('produces different ciphertext each call (random ephemeral key)', async () => {
      const memo = { asset: 0, amount: 10_00, merchant_id: 'merch_123' };
      const enc1 = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);
      const enc2 = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);
      // Different ephemeral keys → different ciphertext every time
      expect(enc1).not.toBe(enc2);
    });

    it('wire format contains required fields with string values', async () => {
      const memo = { asset: 0, amount: 500, merchant_id: 'm_1' };
      const enc = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);

      // Parse the base64 → JSON wire format
      const wire = JSON.parse(atob(enc)) as Record<string, unknown>;

      expect(typeof wire['ephemeral_pk']).toBe('string');
      expect(typeof wire['nonce']).toBe('string');
      expect(typeof wire['ciphertext']).toBe('string');
      expect(typeof wire['auth_tag']).toBe('string');
    });

    it('ephemeral_pk is a 64-char hex string (32 bytes)', async () => {
      const memo = { asset: 1, amount: 2_500_000, merchant_id: 'merch_x' };
      const enc = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);
      const wire = JSON.parse(atob(enc)) as Record<string, unknown>;

      const epk = wire['ephemeral_pk'] as string;
      expect(epk).toMatch(/^[0-9a-f]{64}$/);
    });

    it('nonce is a 24-char hex string (12 bytes)', async () => {
      const memo = { asset: 0, amount: 100, merchant_id: 'm_2' };
      const enc = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);
      const wire = JSON.parse(atob(enc)) as Record<string, unknown>;

      const nonce = wire['nonce'] as string;
      expect(nonce).toMatch(/^[0-9a-f]{24}$/);
    });

    it('auth_tag is a 32-char hex string (16 bytes)', async () => {
      const memo = { asset: 0, amount: 100, merchant_id: 'm_3' };
      const enc = await resource.encryptMemo(memo, TEST_AUDITOR_PK_HEX);
      const wire = JSON.parse(atob(enc)) as Record<string, unknown>;

      const tag = wire['auth_tag'] as string;
      expect(tag).toMatch(/^[0-9a-f]{32}$/);
    });

    it('throws for a non-32-byte auditor public key', async () => {
      const memo = { asset: 0, amount: 100, merchant_id: 'm_4' };
      // 30 bytes instead of 32
      await expect(
        resource.encryptMemo(memo, 'ab'.repeat(30)),
      ).rejects.toThrow(/32 bytes/);
    });

    it('encrypt then decrypt round-trips back to plaintext', async () => {
      // Use a real X25519 keypair generated via Web Crypto so we can test the
      // full encrypt → decrypt round-trip within the SDK itself.
      const auditorKeypair = await crypto.subtle.generateKey(
        { name: 'X25519' },
        true,
        ['deriveBits'],
      ) as CryptoKeyPair;

      const auditorPkRaw = await crypto.subtle.exportKey('raw', auditorKeypair.publicKey);
      const auditorPkHex = Array.from(new Uint8Array(auditorPkRaw))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const auditorSkRaw = await crypto.subtle.exportKey('raw', auditorKeypair.privateKey);
      const auditorSkHex = Array.from(new Uint8Array(auditorSkRaw))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

      const plaintext = { asset: 0, amount: 42_000, merchant_id: 'merch_roundtrip' };

      const enc = await resource.encryptMemo(plaintext, auditorPkHex);
      const dec = await resource.decryptMemo(enc, auditorSkHex);

      expect(dec['asset']).toBe(0);
      expect(dec['amount']).toBe(42_000);
      expect(dec['merchant_id']).toBe('merch_roundtrip');
    });
  });
});
