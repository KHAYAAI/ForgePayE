/**
 * Outbound payout safety properties.
 *
 * These are pure-function tests over validation, approval thresholds and the
 * broadcaster guard — the parts that decide whether money is allowed to move at
 * all. The ledger transitions themselves are SQL-level guarantees (conditional
 * UPDATEs and a unique index) and are exercised against a real Postgres in the
 * integration suite rather than mocked here, because mocking a race condition
 * proves nothing about whether the database actually prevents it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';

// payouts.ts imports db and logger at module scope, and both pull in config.ts,
// which throws on a missing POSTGRES_PASSWORD. Stubbing them at the module
// boundary — the pattern tests/shielded.test.ts already uses — keeps these
// pure-policy tests from needing a database that they never touch.
vi.mock('../src/lib/db.js', () => ({
  getDb: () => { throw new Error('these tests must not reach the database'); },
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  validatePayoutRequest, requiresApproval,
  UnconfiguredBroadcaster, PayoutsNotConfiguredError,
  setPayoutBroadcaster, currentBroadcaster,
  PAYOUT_AUTO_APPROVE_MAX_USD, PAYOUT_ABSOLUTE_MAX_USD,
  type Payout, type PayoutBroadcaster,
} from '../src/lib/payouts.js';

const ADDRESS = '0x1234567890123456789012345678901234567890';

function payout(over: Partial<Payout> = {}): Payout {
  return {
    id: 'p_1',
    externalId: 'ext_1',
    payeeId: 'contrib_aave',
    payeeAddress: ADDRESS,
    chain: 'base',
    amountUsdc: 10,
    status: 'approved',
    reason: 'furnisher revenue share',
    requestedBy: 'agent-credit-bureau',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

const originalEnv = process.env['NODE_ENV'];
afterEach(() => {
  process.env['NODE_ENV'] = originalEnv;
  setPayoutBroadcaster(new UnconfiguredBroadcaster());
});

describe('validatePayoutRequest', () => {
  it('accepts a well-formed request', () => {
    expect(validatePayoutRequest({ externalId: 'ext_1', payeeAddress: ADDRESS, amountUsdc: 10 })).toBeNull();
  });

  it('requires an external_id — it is the idempotency key, not an optional label', () => {
    const err = validatePayoutRequest({ externalId: '', payeeAddress: ADDRESS, amountUsdc: 10 });
    expect(err?.field).toBe('external_id');
  });

  it('rejects a malformed payee address before any money is committed', () => {
    for (const bad of ['', 'not-an-address', '0x123', ADDRESS + 'ff', ADDRESS.replace('0x', '')]) {
      const err = validatePayoutRequest({ externalId: 'e', payeeAddress: bad, amountUsdc: 10 });
      expect(err?.field).toBe('payee_address');
    }
  });

  it('rejects non-positive and non-finite amounts', () => {
    for (const bad of [0, -1, NaN, Infinity]) {
      const err = validatePayoutRequest({ externalId: 'e', payeeAddress: ADDRESS, amountUsdc: bad });
      expect(err?.field).toBe('amount_usdc');
    }
  });

  it('enforces an absolute ceiling no approval can override', () => {
    const err = validatePayoutRequest({
      externalId: 'e', payeeAddress: ADDRESS, amountUsdc: PAYOUT_ABSOLUTE_MAX_USD + 1,
    });
    expect(err?.field).toBe('amount_usdc');
    expect(err?.message).toMatch(/absolute ceiling/);
  });

  it('accepts an amount exactly at the ceiling', () => {
    expect(validatePayoutRequest({
      externalId: 'e', payeeAddress: ADDRESS, amountUsdc: PAYOUT_ABSOLUTE_MAX_USD,
    })).toBeNull();
  });
});

describe('requiresApproval', () => {
  it('lets small automated payouts through without a human', () => {
    // The furnisher revenue share is fractions of a dollar per inquiry; routing
    // every one of those through an approver would make the rail unusable.
    expect(requiresApproval(0.70)).toBe(false);
    expect(requiresApproval(PAYOUT_AUTO_APPROVE_MAX_USD)).toBe(false);
  });

  it('stops anything above the threshold for a human', () => {
    expect(requiresApproval(PAYOUT_AUTO_APPROVE_MAX_USD + 0.01)).toBe(true);
    expect(requiresApproval(10_000)).toBe(true);
  });
});

describe('UnconfiguredBroadcaster — the guard against fabricated payments', () => {
  it('refuses to broadcast in production rather than returning a fake hash', async () => {
    // The property that matters most in this file. A simulated payout reaching
    // a furnisher statement as "sent" is a false record of a payment that never
    // happened — worse for the bureau's credibility than having no rail at all.
    process.env['NODE_ENV'] = 'production';
    const broadcaster = new UnconfiguredBroadcaster();
    await expect(broadcaster.broadcast(payout())).rejects.toBeInstanceOf(PayoutsNotConfiguredError);
  });

  it('simulates outside production so the lifecycle above it is testable', async () => {
    process.env['NODE_ENV'] = 'development';
    const result = await new UnconfiguredBroadcaster().broadcast(payout());
    expect(result.txHash).toMatch(/^0xsimulated_payout_/);
  });

  it('marks a simulated hash as such, so it can never be mistaken for settled', async () => {
    process.env['NODE_ENV'] = 'test';
    const result = await new UnconfiguredBroadcaster().broadcast(payout());
    expect(result.txHash).toContain('simulated');
    expect(result.txHash).not.toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('is the default broadcaster, so an unconfigured deployment fails closed', () => {
    expect(currentBroadcaster().name).toBe('unconfigured');
  });
});

describe('broadcaster seam', () => {
  it('accepts a real broadcaster without the module knowing how it signs', async () => {
    const fake: PayoutBroadcaster = {
      name: 'test-signer',
      broadcast: async () => ({ txHash: '0x' + 'a'.repeat(64) }),
    };
    setPayoutBroadcaster(fake);
    expect(currentBroadcaster().name).toBe('test-signer');
    const result = await currentBroadcaster().broadcast(payout());
    expect(result.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
