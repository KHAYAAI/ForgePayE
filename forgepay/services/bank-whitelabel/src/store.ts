/**
 * In-memory data store for the Bank White-Label Module.
 *
 * Production note: Replace with PostgreSQL using per-bank schemas or row-level security.
 * Each Map here corresponds to a database table. The isolation pattern (filtering by bankId
 * before returning results) maps directly to WHERE bank_id = $1 queries in Postgres.
 */

import { Bank, BankAdmin, BankCustomer, BankTransaction } from './types.js';
import { createHash, randomUUID } from 'node:crypto';

// ── Password hashing ────────────────────────────────────────────────────────

export function hashPassword(password: string): string {
  return createHash('sha256').update(password + 'forgepay_salt').digest('hex');
}

// ── In-memory stores ─────────────────────────────────────────────────────────

const banks: Map<string, Bank> = new Map([
  [
    'investec',
    {
      id: 'investec',
      name: 'Investec Bank',
      slug: 'investec',
      primaryColor: '#003087',
      webhookFormat: 'forgepay',
      webhookSigningKey: randomUUID().replace(/-/g, ''),
      kycInherited: true,
      amlLevel: 'inherited',
      settlementCurrency: 'USD',
      settlementSchedule: 'daily',
      createdAt: new Date().toISOString(),
      status: 'active',
      adminEmails: ['admin@investec.com'],
    },
  ],
]);

const admins: Map<string, BankAdmin> = new Map();
const customers: Map<string, BankCustomer> = new Map();
const transactions: Map<string, BankTransaction> = new Map();

// ── Banks CRUD ────────────────────────────────────────────────────────────────

export const Banks = {
  findAll: (): Bank[] => Array.from(banks.values()),

  findById: (id: string): Bank | undefined => banks.get(id),

  findBySlug: (slug: string): Bank | undefined =>
    Array.from(banks.values()).find((b) => b.slug === slug),

  create: (bank: Bank): Bank => {
    banks.set(bank.id, bank);
    return bank;
  },

  update: (id: string, updates: Partial<Bank>): Bank | null => {
    const existing = banks.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    banks.set(id, updated);
    return updated;
  },

  delete: (id: string): boolean => banks.delete(id),
};

// ── Admins CRUD ───────────────────────────────────────────────────────────────

export const Admins = {
  findByEmail: (email: string): BankAdmin | undefined =>
    Array.from(admins.values()).find((a) => a.email === email),

  findById: (id: string): BankAdmin | undefined => admins.get(id),

  findByBankId: (bankId: string): BankAdmin[] =>
    Array.from(admins.values()).filter((a) => a.bankId === bankId),

  count: (): number => admins.size,

  create: (admin: BankAdmin): BankAdmin => {
    admins.set(admin.id, admin);
    return admin;
  },

  updateLastLogin: (id: string): void => {
    const admin = admins.get(id);
    if (admin) {
      admins.set(id, { ...admin, lastLoginAt: new Date().toISOString() });
    }
  },
};

// ── Customers CRUD ────────────────────────────────────────────────────────────

export const Customers = {
  findByBank: (bankId: string, limit = 100, offset = 0): BankCustomer[] =>
    Array.from(customers.values())
      .filter((c) => c.bankId === bankId)
      .slice(offset, offset + limit),

  countByBank: (bankId: string): number =>
    Array.from(customers.values()).filter((c) => c.bankId === bankId).length,

  findById: (id: string, bankId: string): BankCustomer | null => {
    const c = customers.get(id);
    return c?.bankId === bankId ? c : null;
  },

  findByRef: (bankId: string, bankCustomerRef: string): BankCustomer | undefined =>
    Array.from(customers.values()).find(
      (c) => c.bankId === bankId && c.bankCustomerRef === bankCustomerRef,
    ),

  create: (customer: BankCustomer): BankCustomer => {
    customers.set(customer.id, customer);
    return customer;
  },

  update: (id: string, bankId: string, updates: Partial<BankCustomer>): BankCustomer | null => {
    const existing = customers.get(id);
    if (!existing || existing.bankId !== bankId) return null;
    const updated = { ...existing, ...updates };
    customers.set(id, updated);
    return updated;
  },
};

// ── Transactions CRUD ─────────────────────────────────────────────────────────

export const Transactions = {
  findByBank: (bankId: string, limit = 100, offset = 0): BankTransaction[] =>
    Array.from(transactions.values())
      .filter((t) => t.bankId === bankId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(offset, offset + limit),

  countByBank: (bankId: string): number =>
    Array.from(transactions.values()).filter((t) => t.bankId === bankId).length,

  findById: (id: string, bankId: string): BankTransaction | null => {
    const t = transactions.get(id);
    return t?.bankId === bankId ? t : null;
  },

  findByCustomer: (customerId: string, bankId: string): BankTransaction[] =>
    Array.from(transactions.values()).filter(
      (t) => t.customerId === customerId && t.bankId === bankId,
    ),

  findByBankAndDateRange: (bankId: string, from: Date, to: Date): BankTransaction[] =>
    Array.from(transactions.values()).filter((t) => {
      if (t.bankId !== bankId) return false;
      const createdAt = new Date(t.createdAt);
      return createdAt >= from && createdAt <= to;
    }),

  create: (txn: BankTransaction): BankTransaction => {
    transactions.set(txn.id, txn);
    return txn;
  },

  update: (id: string, bankId: string, updates: Partial<BankTransaction>): BankTransaction | null => {
    const existing = transactions.get(id);
    if (!existing || existing.bankId !== bankId) return null;
    const updated = { ...existing, ...updates };
    transactions.set(id, updated);
    return updated;
  },
};
