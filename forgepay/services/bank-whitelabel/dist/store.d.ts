/**
 * Data store for the Bank White-Label Module.
 *
 * Held in memory and written through to Postgres by persistence.ts, then loaded at start, so a restart no longer loses banks,
 * admins, customers, transactions (which the daily-limit check reads) or the audit log. Each Map corresponds to a table. The
 * isolation pattern (filtering by bankId before returning results) maps to WHERE bank_id = $1 queries in Postgres. Per-bank
 * schemas or row-level security are still to do.
 */
import { Bank, BankAdmin, BankCustomer, BankTransaction } from './types.js';
export declare function hashPassword(password: string): string;
export declare function verifyPassword(password: string, stored: string): boolean;
/** Where changes are made durable. Set by persistence.ts when a database is configured. */
export interface StoreSink {
    bank(b: Bank): void;
    bankRemoved(id: string): void;
    admin(a: BankAdmin): void;
    customer(c: BankCustomer): void;
    transaction(t: BankTransaction): void;
    audit(e: AuditEntry): void;
}
export declare function setStoreSink(s: StoreSink | null): void;
export interface AuditEntry {
    id: string;
    adminId: string;
    bankId: string;
    role: string;
    action: string;
    entityId?: string;
    details?: string;
    ip: string;
    timestamp: string;
}
export declare const AuditLog: {
    record: (entry: Omit<AuditEntry, "id" | "timestamp">) => AuditEntry;
    findByBank: (bankId: string, limit?: number) => AuditEntry[];
    findAll: (limit?: number) => AuditEntry[];
};
/** Replace in-memory state with what was stored (even if a table is empty: a bank may have been deleted on purpose). */
export declare function hydrateStore(rows: {
    banks: Bank[];
    admins: BankAdmin[];
    customers: BankCustomer[];
    transactions: BankTransaction[];
    audit: AuditEntry[];
}): void;
export declare const Banks: {
    findAll: () => Bank[];
    findById: (id: string) => Bank | undefined;
    findBySlug: (slug: string) => Bank | undefined;
    create: (bank: Bank) => Bank;
    update: (id: string, updates: Partial<Bank>) => Bank | null;
    delete: (id: string) => boolean;
};
export declare const Admins: {
    findByEmail: (email: string) => BankAdmin | undefined;
    findById: (id: string) => BankAdmin | undefined;
    findByBankId: (bankId: string) => BankAdmin[];
    count: () => number;
    create: (admin: BankAdmin) => BankAdmin;
    updateLastLogin: (id: string) => void;
};
export declare const Customers: {
    findByBank: (bankId: string, limit?: number, offset?: number) => BankCustomer[];
    countByBank: (bankId: string) => number;
    findById: (id: string, bankId: string) => BankCustomer | null;
    findByRef: (bankId: string, bankCustomerRef: string) => BankCustomer | undefined;
    create: (customer: BankCustomer) => BankCustomer;
    update: (id: string, bankId: string, updates: Partial<BankCustomer>) => BankCustomer | null;
};
export declare const Transactions: {
    findByBank: (bankId: string, limit?: number, offset?: number) => BankTransaction[];
    countByBank: (bankId: string) => number;
    findById: (id: string, bankId: string) => BankTransaction | null;
    findByCustomer: (customerId: string, bankId: string) => BankTransaction[];
    findByBankAndDateRange: (bankId: string, from: Date, to: Date) => BankTransaction[];
    /**
     * Returns the total amountUsd for a customer's non-failed/non-refunded transactions
     * created today (UTC midnight boundary). Used for daily limit enforcement.
     */
    getTodayVolumeForCustomer: (customerId: string, bankId: string) => number;
    create: (txn: BankTransaction) => BankTransaction;
    update: (id: string, bankId: string, updates: Partial<BankTransaction>) => BankTransaction | null;
};
//# sourceMappingURL=store.d.ts.map