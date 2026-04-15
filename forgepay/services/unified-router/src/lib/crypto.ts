/**
 * HMAC-SHA256 signature verification for incoming webhooks.
 * Uses Node.js built-in `crypto` — no external deps.
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
