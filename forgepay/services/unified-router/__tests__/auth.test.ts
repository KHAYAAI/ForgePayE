/**
 * Authentication and route authorisation.
 *
 * These cover the gap that kept the licensing subsystem unmounted: every
 * handler in bundle.ts / csm.ts / customer.ts reads `request.user`, and nothing
 * populated it. The assertions below are mostly about what must be *refused* —
 * an auth layer is only worth having if the negative cases hold.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  hashApiKey,
  safeEqualHex,
  customerAccessError,
  getOperatorKeyHash,
  __resetOperatorKeyCache,
  type AuthContext,
} from '../src/auth';

describe('hashApiKey', () => {
  it('is stable and hex-encoded sha256', () => {
    const h = hashApiKey('some-key');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashApiKey('some-key')).toBe(h);
  });

  it('separates keys that differ by one character', () => {
    expect(hashApiKey('key-a')).not.toBe(hashApiKey('key-b'));
  });
});

describe('safeEqualHex', () => {
  it('matches identical digests', () => {
    const h = hashApiKey('x');
    expect(safeEqualHex(h, h)).toBe(true);
  });

  it('rejects different digests', () => {
    expect(safeEqualHex(hashApiKey('x'), hashApiKey('y'))).toBe(false);
  });

  it('rejects mismatched lengths without throwing', () => {
    expect(safeEqualHex('abcd', hashApiKey('x'))).toBe(false);
  });

  it('never lets malformed input match a real digest', () => {
    // The property that actually matters. An earlier draft of safeEqualHex
    // decoded both sides with Buffer.from(x, 'hex') first, which does not throw
    // on invalid input — Node returns an empty buffer — so malformed values
    // were silently compared as zero-length digests. Comparing the characters
    // avoids that entirely.
    const real = hashApiKey('the-real-key');
    expect(safeEqualHex('zzzz', real)).toBe(false);
    expect(safeEqualHex('', real)).toBe(false);
    expect(safeEqualHex('z'.repeat(64), real)).toBe(false);
  });
});

describe('getOperatorKeyHash — production guard', () => {
  const original = { ...process.env };

  beforeEach(() => {
    __resetOperatorKeyCache();
    process.env = { ...original };
  });

  it('allows the development fallback outside production', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['ROUTER_OPERATOR_API_KEY'];
    expect(() => getOperatorKeyHash()).not.toThrow();
  });

  it('refuses to boot in production with no key', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['ROUTER_OPERATOR_API_KEY'];
    expect(() => getOperatorKeyHash()).toThrow(/is not set/);
  });

  it('refuses the published development key in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ROUTER_OPERATOR_API_KEY'] = 'dev-router-operator-key';
    expect(() => getOperatorKeyHash()).toThrow(/development value/);
  });

  it('refuses a short key in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ROUTER_OPERATOR_API_KEY'] = 'too-short';
    expect(() => getOperatorKeyHash()).toThrow(/at least 32/);
  });

  it('accepts a strong key in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['ROUTER_OPERATOR_API_KEY'] = 'a'.repeat(64);
    expect(() => getOperatorKeyHash()).not.toThrow();
  });
});

describe('customerAccessError — per-resource ownership', () => {
  const customer = (id: string): AuthContext => ({
    principalId: id,
    kind: 'customer',
    tenantId: 'tenant-1',
  });
  const operator: AuthContext = {
    principalId: 'operator',
    kind: 'operator',
    tenantId: null,
  };

  it('lets a customer act on itself', () => {
    expect(customerAccessError(customer('cust-1'), 'cust-1')).toBeNull();
  });

  it('stops a customer acting on another customer', () => {
    // The hole this closes: without it, any authenticated customer could read
    // or mutate a competitor's licensing state by changing the id in the path.
    const err = customerAccessError(customer('cust-1'), 'cust-2');
    expect(err).not.toBeNull();
    expect(err?.error).toBe('Forbidden');
  });

  it('lets the operator act on any customer', () => {
    expect(customerAccessError(operator, 'cust-1')).toBeNull();
    expect(customerAccessError(operator, 'cust-2')).toBeNull();
  });

  it('refuses when there is no auth context at all', () => {
    const err = customerAccessError(undefined, 'cust-1');
    expect(err?.error).toBe('Unauthorized');
  });

  it('returns 403-shaped, not 404-shaped, on a mismatch', () => {
    // The caller authenticated fine; it simply may not act on that resource.
    // Reporting 404 would also leak whether the customer id exists.
    expect(customerAccessError(customer('a'), 'b')?.error).toBe('Forbidden');
  });
});
