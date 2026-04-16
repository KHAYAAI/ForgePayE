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
  signature: string;   // hex or "sha256=<hex>" format
  secret:    string;
}

export function verifyHmacSignature({ payload, signature, secret }: VerifyArgs): boolean {
  if (!secret) return false;

  const expected = createHmac('sha256', secret).update(payload).digest('hex');

  // Support both bare hex and "sha256=<hex>" formats
  const actual = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'));
  } catch {
    // Buffer lengths differ → invalid signature
    return false;
  }
}
