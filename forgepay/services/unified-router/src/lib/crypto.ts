/**
 * HMAC-SHA256 signature verification for incoming webhooks.
 * Uses Node.js built-in `crypto` — no external deps.
 *
 * NOTE: timingSafeEqual is REQUIRED here, not a nice-to-have.
 * A naive string comparison (sig === expected) leaks timing information —
 * an attacker can measure how long the comparison takes to determine how many
 * leading characters of their forged signature are correct, eventually guessing
 * the full HMAC through repeated tries. timingSafeEqual always takes the same
 * time regardless of where the strings differ, closing that side-channel.
 *
 * NOTE: We return false (not throw) for any invalid input (empty secret, wrong
 * length buffer, non-hex string) so the caller always gets a boolean and can
 * safely return HTTP 401 without leaking exception details to the requester.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

interface VerifyArgs {
  payload:   Buffer;
  signature: string;   // hex, or "<algorithm>=<hex>"
  secret:    string;
  /**
   * Hyperswitch signs with HMAC-SHA512 (header X-Webhook-Signature-512, see
   * crates/router/src/core/webhooks/types.rs); every other emitter here uses
   * SHA-256.
   */
  algorithm?: 'sha256' | 'sha512';
}

export function verifyHmacSignature({ payload, signature, secret, algorithm = 'sha256' }: VerifyArgs): boolean {
  if (!secret) return false;

  const expected = createHmac(algorithm, secret).update(payload).digest('hex');

  // Support both bare hex and "<algorithm>=<hex>" formats
  const prefix = `${algorithm}=`;
  const actual = signature.startsWith(prefix) ? signature.slice(prefix.length) : signature;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    // Buffer lengths differ → invalid signature
    return false;
  }
}
