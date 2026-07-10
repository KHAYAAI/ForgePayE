/**
 * Unit tests for the bank-connectivity account service and encryption utility.
 *
 * These tests run entirely in-process with no network calls — Plaid and Open
 * Banking clients are either bypassed (direct service-layer tests) or mocked.
 *
 * Test groups:
 *   1. encrypt / decrypt round-trips
 *   2. linkOpenBankingAccount — link an account without network I/O
 *   3. getAccount — fetch and IDOR protection
 *   4. updateAccount — mutable fields
 *   5. refreshBalance — mocked provider call
 *   6. disconnectAccount — status transition + secret removal
 *   7. getAccountsForMerchant — list and isolation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Set required env vars before importing service modules
process.env.ENCRYPTION_KEY = 'a'.repeat(64);  // 64-char hex string (all 0xaa bytes)
process.env.JWT_SECRET     = 'test-secret';

import { encrypt, decrypt } from '../utils/encryption';

// ── We import accountService after env vars are set ──────────────────────────
// We use a dynamic import workaround so the module picks up the env vars.

// Isolate in-memory state between tests by reimporting the module.
// Vitest module isolation: we use `vi.resetModules()` in beforeEach.

describe('AES-256-GCM encrypt / decrypt', () => {
  it('round-trips a short string', () => {
    const plaintext = 'access-token-abc123';
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it('round-trips a long token string', () => {
    const token = `access-${'x'.repeat(200)}`;
    expect(decrypt(encrypt(token))).toBe(token);
  });

  it('produces different ciphertexts each call (random IV)', () => {
    const plain = 'same-input';
    const c1    = encrypt(plain);
    const c2    = encrypt(plain);
    expect(c1).not.toBe(c2);
    // But both decrypt to the same plaintext
    expect(decrypt(c1)).toBe(plain);
    expect(decrypt(c2)).toBe(plain);
  });

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('sensitive-token');
    const parts      = ciphertext.split('.');
    // Corrupt the data segment
    const corrupted  = `${parts[0]}.${parts[1]}.AAAA${parts[2]}`;
    expect(() => decrypt(corrupted)).toThrow();
  });

  it('throws on wrong number of segments', () => {
    expect(() => decrypt('only.two')).toThrow('Invalid ciphertext format');
  });
});

// ── Account service tests ─────────────────────────────────────────────────────
// We import the service after env is set and use vi.resetModules to get fresh state.

describe('accountService', () => {
  // Fresh module state before each test
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function freshAccountService() {
    // Re-import to get a clean in-memory store
    return await import('../services/accountService');
  }

  it('linkOpenBankingAccount stores account and returns it', async () => {
    const svc        = await freshAccountService();
    const merchantId = 'merchant-001';

    const account = await svc.linkOpenBankingAccount(
      merchantId,
      'consent-abc',
      'ob-account-xyz',
      'EUR',
      'checking',
      '4242',
      'Main EUR Account',
    );

    expect(account.id).toBeTruthy();
    expect(account.merchantId).toBe(merchantId);
    expect(account.obAccountId).toBe('ob-account-xyz');
    expect(account.provider).toBe('open_banking');
    expect(account.currency).toBe('EUR');
    expect(account.mask).toBe('4242');
    expect(account.nickname).toBe('Main EUR Account');
    expect(account.status).toBe('active');
    expect(account.createdAt).toBeTruthy();
    expect(account.updatedAt).toBeTruthy();
  });

  it('getAccountsForMerchant returns only accounts for the given merchant', async () => {
    const svc = await freshAccountService();

    await svc.linkOpenBankingAccount('merchant-A', 'consent-1', 'ob-1', 'GBP', 'checking', '1111');
    await svc.linkOpenBankingAccount('merchant-A', 'consent-2', 'ob-2', 'GBP', 'savings',  '2222');
    await svc.linkOpenBankingAccount('merchant-B', 'consent-3', 'ob-3', 'EUR', 'checking', '3333');

    const accountsA = await svc.getAccountsForMerchant('merchant-A');
    const accountsB = await svc.getAccountsForMerchant('merchant-B');

    expect(accountsA).toHaveLength(2);
    expect(accountsB).toHaveLength(1);
    expect(accountsA.every((a) => a.merchantId === 'merchant-A')).toBe(true);
    expect(accountsB[0].merchantId).toBe('merchant-B');
  });

  it('getAccountsForMerchant returns empty array for unknown merchant', async () => {
    const svc    = await freshAccountService();
    const result = await svc.getAccountsForMerchant('nonexistent-merchant');
    expect(result).toEqual([]);
  });

  it('getAccount returns account when merchant matches', async () => {
    const svc        = await freshAccountService();
    const merchantId = 'merchant-001';

    const linked  = await svc.linkOpenBankingAccount(merchantId, 'c1', 'ob-1', 'USD', 'checking', '9999');
    const fetched = await svc.getAccount(linked.id, merchantId);

    expect(fetched.id).toBe(linked.id);
  });

  it('getAccount throws NOT_FOUND for wrong merchantId (IDOR protection)', async () => {
    const svc = await freshAccountService();

    const linked = await svc.linkOpenBankingAccount('merchant-A', 'c1', 'ob-1', 'USD', 'checking', '0000');

    await expect(svc.getAccount(linked.id, 'merchant-B')).rejects.toThrow();
    try {
      await svc.getAccount(linked.id, 'merchant-B');
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('NOT_FOUND');
    }
  });

  it('updateAccount patches nickname and returns updated record', async () => {
    const svc        = await freshAccountService();
    const merchantId = 'merchant-001';

    const linked  = await svc.linkOpenBankingAccount(merchantId, 'c1', 'ob-1', 'USD', 'checking', '1234');
    const updated = await svc.updateAccount(linked.id, merchantId, { nickname: 'Ops Account' });

    expect(updated.nickname).toBe('Ops Account');
    expect(updated.id).toBe(linked.id);
    expect(updated.merchantId).toBe(merchantId);
    // updatedAt is an ISO string and must be a valid date
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThan(0);
  });

  it('disconnectAccount marks account as disconnected and removes secret', async () => {
    const svc        = await freshAccountService();
    const merchantId = 'merchant-001';

    const linked = await svc.linkOpenBankingAccount(merchantId, 'c1', 'ob-1', 'USD', 'checking', '5678');
    await svc.disconnectAccount(linked.id, merchantId);

    // Disconnected accounts are excluded from list queries
    const accounts = await svc.getAccountsForMerchant(merchantId);
    expect(accounts.find((a) => a.id === linked.id)).toBeUndefined();

    // But still exist (for audit history) — getAccount should find it when we look directly
    // Note: the underlying map still has the record with status 'disconnected'
    // Access token should be gone
    await expect(svc.getAccessToken(linked.id)).rejects.toThrow();
  });

  it('refreshBalance updates stored balances (OB mocked)', async () => {
    // Mock the OB client before importing the service
    vi.mock('../openbanking/client', () => ({
      getOpenBankingClient: () => ({
        getBalances: vi.fn().mockResolvedValue([
          {
            accountId: 'ob-1',
            amount:    5000.00,
            currency:  'GBP',
            type:      'InterimBooked',
            dateTime:  new Date().toISOString(),
          },
          {
            accountId: 'ob-1',
            amount:    4800.00,
            currency:  'GBP',
            type:      'InterimAvailable',
            dateTime:  new Date().toISOString(),
          },
        ]),
      }),
    }));

    const svc        = await freshAccountService();
    const merchantId = 'merchant-001';

    const linked   = await svc.linkOpenBankingAccount(merchantId, 'consent-abc', 'ob-1', 'GBP', 'checking', '9876');
    const refreshed = await svc.refreshBalance(linked.id, merchantId);

    expect(refreshed.balanceCurrent).toBe(5000.00);
    expect(refreshed.balanceAvailable).toBe(4800.00);
    expect(refreshed.balanceLastUpdated).toBeTruthy();
    expect(refreshed.updatedAt).not.toBe(linked.updatedAt);
  });
});

// ── Transfer service basic smoke tests ───────────────────────────────────────

describe('transferService — initiate and list', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('listTransfers returns empty for unknown merchant', async () => {
    const svc    = await import('../services/transferService');
    const result = await svc.listTransfers({ merchantId: 'nobody' });
    expect(result.transfers).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.hasMore).toBe(false);
  });

  it('getTransfer throws NOT_FOUND for unknown id', async () => {
    const svc = await import('../services/transferService');
    try {
      await svc.getTransfer('00000000-0000-0000-0000-000000000000', 'merchant-A');
      expect(true).toBe(false); // should not reach here
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('NOT_FOUND');
    }
  });
});
