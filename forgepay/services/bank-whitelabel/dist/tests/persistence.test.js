/**
 * Banks, admins, customers, transactions and the audit log survive a restart. Unit tests cover the write-through hook and
 * hydration; the database test (skipped without DATABASE_URL, run in CI against Postgres) restarts for real, including the
 * day's transaction volume that the daily-limit check reads.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Admins, AuditLog, Banks, Customers, hashPassword, hydrateStore, setStoreSink, Transactions, verifyPassword, } from '../store.js';
import { assertPersistenceConfigured, isDbEnabled } from '../persistence.js';
const now = () => new Date().toISOString();
const bank = (id) => ({
    id, name: id, slug: id, webhookFormat: 'forgepay', webhookSigningKey: 'sign-key', kycInherited: true, amlLevel: 'inherited',
    settlementCurrency: 'USD', settlementSchedule: 'daily', createdAt: now(), status: 'active', adminEmails: [],
});
const customer = (bankId) => ({
    id: randomUUID(), bankId, bankCustomerRef: 'c-1', kycStatus: 'approved', dailyLimitUsd: 1000, status: 'active', createdAt: now(),
});
const txn = (bankId, customerId, amountUsd) => ({
    id: randomUUID(), bankId, customerId, amountUsd, status: 'completed', createdAt: now(),
});
const empty = () => hydrateStore({ banks: [], admins: [], customers: [], transactions: [], audit: [] });
afterEach(() => { setStoreSink(null); empty(); });
describe('write-through hooks', () => {
    it('every change reaches the sink', () => {
        const seen = [];
        const sink = {
            bank: (b) => seen.push(`bank:${b.id}`), bankRemoved: (id) => seen.push(`bankRemoved:${id}`),
            admin: (a) => seen.push(`admin:${a.email}`), customer: (c) => seen.push(`customer:${c.bankCustomerRef}`),
            transaction: (t) => seen.push(`txn:${t.amountUsd}`), audit: (e) => seen.push(`audit:${e.action}`),
        };
        setStoreSink(sink);
        const b = Banks.create(bank('b1'));
        Banks.update('b1', { name: 'Renamed' });
        const a = Admins.create({ id: 'a1', bankId: 'b1', email: 'x@b1.test', passwordHash: hashPassword('long-enough-password'), role: 'admin', createdAt: now() });
        Admins.updateLastLogin(a.id);
        const c = Customers.create(customer('b1'));
        Customers.update(c.id, 'b1', { status: 'suspended' });
        const t = Transactions.create(txn('b1', c.id, 25));
        Transactions.update(t.id, 'b1', { status: 'refunded' });
        AuditLog.record({ adminId: 'a1', bankId: 'b1', role: 'admin', action: 'bank.update', ip: '127.0.0.1' });
        expect(Banks.delete(b.id)).toBe(true);
        expect(Banks.delete(b.id)).toBe(false); // nothing to remove: no second write
        expect(seen).toEqual([
            'bank:b1', 'bank:b1', 'admin:x@b1.test', 'admin:x@b1.test', 'customer:c-1', 'customer:c-1', 'txn:25', 'txn:25', 'audit:bank.update', 'bankRemoved:b1',
        ]);
    });
});
describe('hydration', () => {
    it('restores everything, replaces what was in memory, and an emptied table stays empty', () => {
        Banks.create(bank('stale'));
        const b = bank('real');
        const c = customer('real');
        hydrateStore({
            banks: [b], admins: [{ id: 'a', bankId: 'real', email: 'a@real.test', passwordHash: hashPassword('long-enough-password'), role: 'super_admin', createdAt: now() }],
            customers: [c], transactions: [txn('real', c.id, 40), txn('real', c.id, 60)], audit: [],
        });
        expect(Banks.findAll().map((x) => x.id)).toEqual(['real']);
        expect(Admins.count()).toBe(1);
        expect(Transactions.getTodayVolumeForCustomer(c.id, 'real')).toBe(100); // the daily limit sees stored spend
        expect(verifyPassword('long-enough-password', Admins.findByEmail('a@real.test').passwordHash)).toBe(true);
        empty();
        expect(Banks.findAll()).toEqual([]);
    });
});
describe('configuration guard', () => {
    it('refuses to start in production without a database', () => {
        expect(() => assertPersistenceConfigured({ NODE_ENV: 'production' })).toThrow(/refuses to start/);
        expect(() => assertPersistenceConfigured({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x' })).not.toThrow();
        expect(isDbEnabled({})).toBe(false);
    });
});
const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? describe : describe.skip;
dbSuite('against a real database', () => {
    let p;
    const wait = () => new Promise((r) => setTimeout(r, 500));
    beforeAll(async () => {
        p = await import('../persistence.js');
        await p.runMigrations();
        const { Pool } = await import('pg');
        const pool = new Pool({ connectionString: process.env['DATABASE_URL'] });
        await pool.query('TRUNCATE bwl_banks, bwl_admins, bwl_customers, bwl_transactions, bwl_audit');
        await pool.end();
    });
    afterAll(async () => { p.detachPersistence(); await p.closePool(); });
    it('keeps banks, admins, customers, transactions and audit across a restart', async () => {
        empty();
        await p.initPersistence(); // first start on an empty database
        Banks.create(bank('acme'));
        Admins.create({ id: 'adm-1', bankId: 'acme', email: 'boss@acme.test', passwordHash: hashPassword('long-enough-password'), role: 'admin', createdAt: now() });
        const c = Customers.create(customer('acme'));
        Transactions.create(txn('acme', c.id, 300));
        Transactions.create(txn('acme', c.id, 200));
        AuditLog.record({ adminId: 'adm-1', bankId: 'acme', role: 'admin', action: 'customer.suspend', ip: '10.0.0.1' });
        await wait();
        p.detachPersistence();
        empty(); // the pod restarts
        await p.initPersistence();
        expect(Banks.findById('acme')?.name).toBe('acme');
        expect(Admins.findByEmail('boss@acme.test')?.role).toBe('admin');
        expect(Customers.findById(c.id, 'acme')?.bankCustomerRef).toBe('c-1');
        expect(Transactions.getTodayVolumeForCustomer(c.id, 'acme')).toBe(500); // the daily limit still sees today's spend
        expect(AuditLog.findByBank('acme').map((e) => e.action)).toContain('customer.suspend');
    });
});
//# sourceMappingURL=persistence.test.js.map