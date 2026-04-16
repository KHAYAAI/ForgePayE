/**
 * Tests for HMAC-SHA256 webhook signature verification.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmacSignature } from '../lib/crypto.js';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyHmacSignature', () => {
  const secret  = 'test_webhook_secret';
  const payload = Buffer.from('{"event_type":"payment.succeeded"}');

  it('accepts a valid sha256= prefixed signature', () => {
    const sig = `sha256=${sign(payload.toString(), secret)}`;
    expect(verifyHmacSignature({ payload, signature: sig, secret })).toBe(true);
  });

  it('accepts a bare hex signature (no prefix)', () => {
    const sig = sign(payload.toString(), secret);
    expect(verifyHmacSignature({ payload, signature: sig, secret })).toBe(true);
  });

  it('rejects a tampered payload', () => {
    const sig    = `sha256=${sign(payload.toString(), secret)}`;
    const tampered = Buffer.from('{"event_type":"payment.succeeded","injected":"hack"}');
    expect(verifyHmacSignature({ payload: tampered, signature: sig, secret })).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = `sha256=${sign(payload.toString(), 'wrong_secret')}`;
    expect(verifyHmacSignature({ payload, signature: sig, secret })).toBe(false);
  });

  it('returns false when secret is empty (fail-secure)', () => {
    const sig = `sha256=${sign(payload.toString(), '')}`;
    expect(verifyHmacSignature({ payload, signature: sig, secret: '' })).toBe(false);
  });

  it('handles truncated / malformed signatures gracefully', () => {
    expect(verifyHmacSignature({ payload, signature: 'sha256=abc', secret })).toBe(false);
    expect(verifyHmacSignature({ payload, signature: '', secret })).toBe(false);
  });
});
