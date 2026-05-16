import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, Banks, Customers, Transactions, AuditLog } from '../store.js';
import type { BankCustomer, BankTransaction } from '../types.js';
import { randomUUID } from 'node:crypto';

// ── Password hashing ──────────────────────────────────────────────────────────

describe('password hashing', () => {
  it('hashPassword produces scrypt: prefix format', () => {
    const hash = hashPassword('hunter2');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(hash.split(':')).toHaveLength(3);
  });

  it('verifyPassword accepts correct password', () => {
    const hash = hashPassword('correct-horse-battery');
    expect(verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('verifyPassword rejects wrong password', () => {
    const hash = hashPassword('secret');
    expect(verifyPassword('WRONG', hash)).toBe(false);
  });

  it('produces different hashes for same password (random salt)', () => {
    const h1 = hashPassword('samepass');
    const h2 = hashPassword('samepass');
    expect(h1).not.toBe(h2);
    // But both should verify
    expect(verifyPassword('samepass', h1)).toBe(true);
    expect(verifyPassword('samepass', h2)).toBe(true);
  });

  it('verifyPassword returns false for non-scrypt format', () => {
    expect(verifyPassword('anything', 'sha256hexhash')).toBe(false);
  });
});

// ── Banks store ───────────────────────────────────────────────────────────────

describe('Banks store', () => {
  it('findById returns seeded Investec bank', () => {
    const bank = Banks.findById('investec');
    expect(bank).toBeDefined();
    expect(bank!.name).toBe('Investec Bank');
  });

  it('create and findById round-trip', () => {
    const id = `bank_${randomUUID()}`;
    Banks.create({
      id,
      name:               'Test Bank',
      slug:               'test-bank',
      webhookFormat:      'forgepay',
      kycInherited:       false,
      amlLevel:           'standard',
      settlementCurrency: 'USD',
      settlementSchedule: 'daily',
      createdAt:          new Date().toISOString(),
      status:             'active',
      adminEmails:        [],
    });
    const found = Banks.findById(id);
    expect(found!.name).toBe('Test Bank');
  });

  it('update changes fields', () => {
    const updated = Banks.update('investec', { name: 'Investec Updated' });
    expect(updated!.name).toBe('Investec Updated');
    // Restore
    Banks.update('investec', { name: 'Investec Bank' });
  });
});

// ── Customers store ───────────────────────────────────────────────────────────

describe('Customers store', () => {
  const bankId = 'investec';

  function createTestCustomer(ref?: string): BankCustomer {
    return Customers.create({
      id:               randomUUID(),
      bankId,
      bankCustomerRef:  ref ?? `ref_${randomUUID()}`,
      kycStatus:        'approved',
      riskLevel:        'low',
      dailyLimitUsd:    10_000,
      totalVolumeUsd:   0,
      transactionCount: 0,
      createdAt:        new Date().toISOString(),
      status:           'active',
    });
  }

  it('create and findById scoped to bankId', () => {
    const c = createTestCustomer();
    expect(Customers.findById(c.id, bankId)).toBeDefined();
    expect(Customers.findById(c.id, 'other-bank')).toBeNull();
  });

  it('findByRef returns matching customer', () => {
    const ref = `unique_${randomUUID()}`;
    const c = createTestCustomer(ref);
    expect(Customers.findByRef(bankId, ref)?.id).toBe(c.id);
  });

  it('getTodayVolumeForCustomer returns 0 initially', () => {
    const c = createTestCustomer();
    expect(Transactions.getTodayVolumeForCustomer(c.id, bankId)).toBe(0);
  });

  it('getTodayVolumeForCustomer sums confirmed + pending transactions', () => {
    const c = createTestCustomer();

    const makeTxn = (amountUsd: number, status: BankTransaction['status']): BankTransaction => ({
      id:           randomUUID(),
      bankId,
      customerId:   c.id,
      type:         'crypto_purchase',
      asset:        'BTC',
      amountCrypto: 0.01,
      amountUsd,
      feeUsd:       10,
      netAmountUsd: amountUsd - 10,
      status,
      createdAt:    new Date().toISOString(),
    });

    Transactions.create(makeTxn(1000, 'confirmed'));
    Transactions.create(makeTxn(500,  'pending'));
    Transactions.create(makeTxn(200,  'failed'));   // should not count
    Transactions.create(makeTxn(100,  'refunded')); // should not count

    const vol = Transactions.getTodayVolumeForCustomer(c.id, bankId);
    expect(vol).toBe(1500); // confirmed + pending only
  });
});

// ── Audit log ─────────────────────────────────────────────────────────────────

describe('AuditLog', () => {
  it('records entries with id and timestamp', () => {
    const entry = AuditLog.record({
      adminId: 'admin-1',
      bankId:  'investec',
      role:    'admin',
      action:  'customer.suspend',
      ip:      '127.0.0.1',
    });
    expect(entry.id).toBeDefined();
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('findByBank scopes to bankId', () => {
    AuditLog.record({
      adminId: 'admin-1',
      bankId:  'test-bank-audit',
      role:    'admin',
      action:  'bank.update',
      ip:      '1.2.3.4',
    });
    const entries = AuditLog.findByBank('test-bank-audit');
    expect(entries.every(e => e.bankId === 'test-bank-audit')).toBe(true);
  });
});
