/**
 * The outbound signer's refusals.
 *
 * Almost every test here asserts that money does NOT move. That is the right
 * balance for this file: the happy path is one ERC-20 transfer and is exercised
 * against a testnet, while the failure modes — signing when nobody asked,
 * signing on the wrong chain, signing past a ceiling, leaking a key into a log
 * — are the ones that cannot be discovered safely in production.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({ query: vi.fn().mockResolvedValue({ rows: [{ total: '0' }] }) }),
}));
vi.mock('../src/lib/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  signerRequested, resolveSignerConfig, installPayoutSigner,
  PayoutSignerConfigError,
} from '../src/lib/payout-signer.js';
import { currentBroadcaster, setPayoutBroadcaster, UnconfiguredBroadcaster } from '../src/lib/payouts.js';

const ORIGINAL_ENV = { ...process.env };

// A well-formed key that has never held funds — only used to prove the signer
// constructs and derives an address. Never put a funded key in a test.
const THROWAWAY_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function configure(over: Record<string, string> = {}) {
  process.env['PAYOUT_SIGNER_ENABLED'] = 'true';
  process.env['PAYOUT_SIGNER_CHAIN'] = 'base';
  process.env['PAYOUT_SIGNER_RPC_URL'] = 'https://base.example.invalid';
  process.env['PAYOUT_SIGNER_DAILY_MAX_USD'] = '5000';
  process.env['PAYOUT_SIGNER_PRIVATE_KEY'] = THROWAWAY_KEY;
  Object.assign(process.env, over);
}

function clearSignerEnv() {
  for (const k of [
    'PAYOUT_SIGNER_ENABLED', 'PAYOUT_SIGNER_CHAIN', 'PAYOUT_SIGNER_RPC_URL',
    'PAYOUT_SIGNER_DAILY_MAX_USD', 'PAYOUT_SIGNER_PRIVATE_KEY', 'PAYOUT_SIGNER_KEY_FILE',
    'PAYOUT_SIGNER_CONFIRMATIONS',
  ]) delete process.env[k];
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  clearSignerEnv();
  setPayoutBroadcaster(new UnconfiguredBroadcaster());
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  setPayoutBroadcaster(new UnconfiguredBroadcaster());
});

describe('the signer is off unless asked for', () => {
  it('installs nothing when PAYOUT_SIGNER_ENABLED is unset', () => {
    const result = installPayoutSigner();
    expect(result.installed).toBe(false);
    expect(currentBroadcaster().name).toBe('unconfigured');
  });

  it('installs nothing when the flag is any value other than "true"', () => {
    // No truthiness games on a switch that decides whether a service can move
    // money: "1", "yes" and "TRUE" all mean "not enabled".
    for (const v of ['1', 'yes', 'TRUE', 'on', '']) {
      process.env['PAYOUT_SIGNER_ENABLED'] = v;
      expect(signerRequested()).toBe(false);
      expect(installPayoutSigner().installed).toBe(false);
    }
  });

  it('leaves the refusing broadcaster in place, so an unsigned deployment cannot fabricate a hash', () => {
    installPayoutSigner();
    expect(currentBroadcaster().name).toBe('unconfigured');
  });
});

describe('a requested signer must be completely configured', () => {
  it('refuses without a chain', () => {
    configure(); delete process.env['PAYOUT_SIGNER_CHAIN'];
    expect(() => resolveSignerConfig()).toThrow(PayoutSignerConfigError);
  });

  it('refuses a chain it has no USDC address for', () => {
    // The failure mode of guessing here is USDC sent to something that is not
    // USDC, so an unknown chain is refused rather than defaulted.
    configure({ PAYOUT_SIGNER_CHAIN: 'solana' });
    expect(() => resolveSignerConfig()).toThrow(/not a supported chain/);
  });

  it('refuses without an RPC url', () => {
    configure(); delete process.env['PAYOUT_SIGNER_RPC_URL'];
    expect(() => resolveSignerConfig()).toThrow(/RPC_URL/);
  });

  it('refuses without a daily ceiling rather than defaulting to one', () => {
    // Per-payout limits bound one mistake; only this bounds a loop. There is no
    // safe default for someone else's hot wallet.
    configure(); delete process.env['PAYOUT_SIGNER_DAILY_MAX_USD'];
    expect(() => resolveSignerConfig()).toThrow(/daily ceiling/);
  });

  it('refuses a non-positive or malformed daily ceiling', () => {
    for (const v of ['0', '-100', 'lots']) {
      configure({ PAYOUT_SIGNER_DAILY_MAX_USD: v });
      expect(() => resolveSignerConfig()).toThrow(/positive number/);
    }
  });

  it('throws rather than silently staying unsigned when enabled without a key', () => {
    // A deployment that asked to move money and cannot must fail loudly: a
    // refusing broadcaster looks identical to a working one until the first
    // settlement run quietly does nothing.
    configure(); delete process.env['PAYOUT_SIGNER_PRIVATE_KEY'];
    expect(() => installPayoutSigner()).toThrow(/no key is configured/);
  });

  it('accepts a fully specified configuration', () => {
    configure();
    const cfg = resolveSignerConfig();
    expect(cfg.chain).toBe('base');
    expect(cfg.chainId).toBe(8453);
    expect(cfg.usdcAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(cfg.dailyMaxUsd).toBe(5000);
    expect(cfg.confirmations).toBeGreaterThanOrEqual(1);
  });
});

describe('key handling', () => {
  it('never puts key material in the error raised for a malformed key', () => {
    // The single most damaging thing this file could do is echo a private key
    // into a log line, so the message is asserted to contain none of it.
    const secret = '0xdeadbeefnotavalidkey';
    configure({ PAYOUT_SIGNER_PRIVATE_KEY: secret });

    let message = '';
    try { installPayoutSigner(); } catch (err) { message = err instanceof Error ? err.message : String(err); }

    expect(message).toMatch(/not a valid private key/);
    expect(message).not.toContain(secret);
    expect(message).not.toContain('deadbeef');
  });

  it('does not leak the path contents when a key file is unreadable', () => {
    configure();
    delete process.env['PAYOUT_SIGNER_PRIVATE_KEY'];
    process.env['PAYOUT_SIGNER_KEY_FILE'] = '/nonexistent/payout.key';
    expect(() => installPayoutSigner()).toThrow(/could not be read/);
  });

  it('installs from a well-formed key and reports the address funds leave from', () => {
    configure();
    const result = installPayoutSigner();
    expect(result.installed).toBe(true);
    expect(result.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(result.chain).toBe('base');
    expect(currentBroadcaster().name).toBe('usdc-erc20');
  });
});

describe('refusals at broadcast time', () => {
  const payout = (over: Record<string, unknown> = {}) => ({
    id: 'p_1',
    externalId: 'ext_1',
    payeeId: 'contrib_aave',
    payeeAddress: '0x1234567890123456789012345678901234567890',
    chain: 'base',
    amountUsdc: 10,
    status: 'approved' as const,
    reason: 'furnisher revenue share',
    requestedBy: 'agent-credit-bureau',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  });

  it('refuses a payout for a different chain than it is configured for', async () => {
    // A signer pointed at Base must never send an Arbitrum payout: same
    // address, different network, and the funds are simply gone.
    configure();
    installPayoutSigner();
    await expect(currentBroadcaster().broadcast(payout({ chain: 'arbitrum' })))
      .rejects.toThrow(/wrong chain/);
  });

  it('re-checks the absolute ceiling at send time, not only at creation', async () => {
    // An approved row can sit for a long time before anyone submits it.
    configure();
    installPayoutSigner();
    await expect(currentBroadcaster().broadcast(payout({ amountUsdc: 1_000_000 })))
      .rejects.toThrow(/absolute ceiling/);
  });
});
