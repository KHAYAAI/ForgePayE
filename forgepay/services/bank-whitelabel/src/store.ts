/**
 * Data store for the Bank White-Label Module.
 *
 * Held in memory and written through to Postgres by persistence.ts, then loaded at start, so a restart no longer loses banks,
 * admins, customers, transactions (which the daily-limit check reads) or the audit log. Each Map corresponds to a table. The
 * isolation pattern (filtering by bankId before returning results) maps to WHERE bank_id = $1 queries in Postgres. Per-bank
 * schemas or row-level security are still to do.
 */

import { Bank, BankAdmin, BankCustomer, BankTransaction } from './types.js';
import { scryptSync, randomBytes, timingSafeEqual, randomUUID } from 'node:crypto';

// ── Password hashing ──────────────────────────────────────────────────────────
// scrypt with N=16384, r=8, p=1: memory-hard, resistant to GPU attacks.
// Format stored: "scrypt:<saltHex>:<hashHex>"

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };
const HASH_LEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, HASH_LEN, SCRYPT_PARAMS);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (stored.startsWith('scrypt:')) {
    const parts = stored.split(':');
    if (parts.length !== 3) return false;
    const salt = Buffer.from(parts[1]!, 'hex');
    const expectedHash = Buffer.from(parts[2]!, 'hex');
    const actualHash = scryptSync(password, salt, HASH_LEN, SCRYPT_PARAMS);
    if (actualHash.length !== expectedHash.length) return false;
    return timingSafeEqual(actualHash, expectedHash);
  }
  return false;
}

// ── Durability hook ───────────────────────────────────────────────────────────

/** Where changes are made durable. Set by persistence.ts when a database is configured. */
export interface StoreSink {
  bank(b: Bank): void;
  bankRemoved(id: string): void;
  admin(a: BankAdmin): void;
  customer(c: BankCustomer): void;
  transaction(t: BankTransaction): void;
  audit(e: AuditEntry): void;
}
let sink: StoreSink | null = null;
export function setStoreSink(s: StoreSink | null): void { sink = s; }

// ── Audit log ──────────────────────────────────────────────────────────────────

export interface AuditEntry {
  id:        string;
  adminId:   string;
  bankId:    string;
  role:      string;
  action:    string;       // e.g. "customer.suspend", "bank.update"
  entityId?: string;       // affected resource ID
  details?:  string;       // human-readable summary
  ip:        string;
  timestamp: string;
}

const auditLog: AuditEntry[] = [];
const MAX_AUDIT_ENTRIES = 2000;

export const AuditLog = {
  record: (entry: Omit<AuditEntry, 'id' | 'timestamp'>): AuditEntry => {
    const full: AuditEntry = {
      ...entry,
      id:        randomUUID(),
      timestamp: new Date().toISOString(),
    };
    auditLog.push(full);
    if (auditLog.length > MAX_AUDIT_ENTRIES) auditLog.shift();
    sink?.audit(full);
    return full;
  },

  findByBank: (bankId: string, limit = 100): AuditEntry[] =>
    auditLog
      .filter(e => e.bankId === bankId)
      .slice(-Math.min(limit, 500)),

  findAll: (limit = 200): AuditEntry[] =>
    auditLog.slice(-Math.min(limit, 500)),
};

// ── In-memory stores ──────────────────────────────────────────────────────────

/**
 * A demonstration bank, for development only. It used to exist in every environment, which put a named bank (and a
 * signing key regenerated on every start) into production. In production the map starts empty and a super admin creates banks.
 */
const DEMO_BANKS: Array<[string, Bank]> = process.env['NODE_ENV'] === 'production' ? [] : [
  [
    'investec',
    {
      id:                  'investec',
      name:                'Investec Bank',
      slug:                'investec',
      primaryColor:        '#003087',
      webhookFormat:       'forgepay',
      webhookSigningKey:   randomUUID().replace(/-/g, ''),
      kycInherited:        true,
      amlLevel:            'inherited',
      settlementCurrency:  'USD',
      settlementSchedule:  'daily',
      createdAt:           new Date().toISOString(),
      status:              'active',
      adminEmails:         ['admin@investec.com'],
    },
  ],
];

const banks: Map<string, Bank> = new Map(DEMO_BANKS);

const admins: Map<string, BankAdmin>       = new Map();
const customers: Map<string, BankCustomer> = new Map();
const transactions: Map<string, BankTransaction> = new Map();

/** Replace in-memory state with what was stored (even if a table is empty: a bank may have been deleted on purpose). */
export function hydrateStore(rows: {
  banks: Bank[]; admins: BankAdmin[]; customers: BankCustomer[]; transactions: BankTransaction[]; audit: AuditEntry[];
}): void {
  banks.clear(); admins.clear(); customers.clear(); transactions.clear(); auditLog.length = 0;
  for (const b of rows.banks) banks.set(b.id, b);
  for (const a of rows.admins) admins.set(a.id, a);
  for (const c of rows.customers) customers.set(c.id, c);
  for (const t of rows.transactions) transactions.set(t.id, t);
  auditLog.push(...rows.audit.slice(-MAX_AUDIT_ENTRIES));
}

// ── Banks CRUD ────────────────────────────────────────────────────────────────

export const Banks = {
  findAll: (): Bank[] => Array.from(banks.values()),

  findById: (id: string): Bank | undefined => banks.get(id),

  findBySlug: (slug: string): Bank | undefined =>
    Array.from(banks.values()).find((b) => b.slug === slug),

  create: (bank: Bank): Bank => {
    banks.set(bank.id, bank);
    sink?.bank(bank);
    return bank;
  },

  update: (id: string, updates: Partial<Bank>): Bank | null => {
    const existing = banks.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    banks.set(id, updated);
    sink?.bank(updated);
    return updated;
  },

  delete: (id: string): boolean => {
    const removed = banks.delete(id);
    if (removed) sink?.bankRemoved(id);
    return removed;
  },
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
    sink?.admin(admin);
    return admin;
  },

  updateLastLogin: (id: string): void => {
    const admin = admins.get(id);
    if (admin) {
      const updated = { ...admin, lastLoginAt: new Date().toISOString() };
      admins.set(id, updated);
      sink?.admin(updated);
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
    sink?.customer(customer);
    return customer;
  },

  update: (id: string, bankId: string, updates: Partial<BankCustomer>): BankCustomer | null => {
    const existing = customers.get(id);
    if (!existing || existing.bankId !== bankId) return null;
    const updated = { ...existing, ...updates };
    customers.set(id, updated);
    sink?.customer(updated);
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

  /**
   * Returns the total amountUsd for a customer's non-failed/non-refunded transactions
   * created today (UTC midnight boundary). Used for daily limit enforcement.
   */
  getTodayVolumeForCustomer: (customerId: string, bankId: string): number => {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    return Array.from(transactions.values())
      .filter(t =>
        t.customerId === customerId &&
        t.bankId === bankId &&
        t.status !== 'failed' &&
        t.status !== 'refunded' &&
        new Date(t.createdAt) >= todayStart,
      )
      .reduce((sum, t) => sum + t.amountUsd, 0);
  },

  create: (txn: BankTransaction): BankTransaction => {
    transactions.set(txn.id, txn);
    sink?.transaction(txn);
    return txn;
  },

  update: (id: string, bankId: string, updates: Partial<BankTransaction>): BankTransaction | null => {
    const existing = transactions.get(id);
    if (!existing || existing.bankId !== bankId) return null;
    const updated = { ...existing, ...updates };
    transactions.set(id, updated);
    sink?.transaction(updated);
    return updated;
  },
};
