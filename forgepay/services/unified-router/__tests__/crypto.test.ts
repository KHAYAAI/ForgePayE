/**
 * Tests for HMAC-SHA256 webhook signature verification.
 */

import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyHmacSignature } from '../src/lib/crypto.js';

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('verifyHmacSignature', () => {
  const secret  = 'test_webhook_secret';
  const payload = Buffer.from('{"event_type":"payment.succeeded"}');

  it('accepts a valid bare hex signature', () => {
    const sig = sign(payload.toString(), secret);
    expect(verifyHmacSignature({ payload, signature: sig, secret })).toBe(true);
  });

  it('accepts a valid signature with sha256= prefix', () => {
    const sig = `sha256=${sign(payload.toString(), secret)}`;
    expect(verifyHmacSignature({ payload, signature: sig, secret })).toBe(true);
  });

  it('rejects a wrong signature', () => {
    const sig = sign(payload.toString(), 'wrong_secret');
    expect(verifyHmacSignature({ payload, signature: sig, secret })).toBe(false);
  });

  it('returns false when secret is empty', () => {
    const sig = sign(payload.toString(), 'any_secret');
    expect(verifyHmacSignature({ payload, signature: sig, secret: '' })).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const sig      = `sha256=${sign(payload.toString(), secret)}`;
    const tampered = Buffer.from('{"event_type":"payment.succeeded","injected":true}');
    expect(verifyHmacSignature({ payload: tampered, signature: sig, secret })).toBe(false);
  });

  it('returns false for a malformed (truncated) signature', () => {
    expect(verifyHmacSignature({ payload, signature: 'sha256=abc', secret })).toBe(false);
  });

  it('returns false for an empty signature string', () => {
    expect(verifyHmacSignature({ payload, signature: '', secret })).toBe(false);
  });
});
