/**
 * Generated reports survive a restart. Unit tests cover the write-through hook and hydration; the database test (skipped
 * without DATABASE_URL, run in CI against Postgres) restarts for real.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { clearReports, getReport, hydrateReports, listReports, saveReport, setReportSink, type StoredReport } from '../store';
import { assertPersistenceConfigured, isDbEnabled } from '../persistence';
import type { ReportPayload } from '../types';

const PERIOD = { start: '2026-01-01', end: '2026-01-31' };
const payload = (n = 1): ReportPayload => ({ period: PERIOD, totalGrossFlowsUsd: n, totalNetFlowsUsd: n, feesAvoidedUsd: 0, byPair: [] } as unknown as ReportPayload);

afterEach(() => { setReportSink(null); clearReports(); });

describe('write-through', () => {
  it('a saved report reaches the sink with its metadata and payload', () => {
    const seen: Array<[string, string, number]> = [];
    setReportSink({ save: (id, meta, p) => seen.push([id, meta.type, (p as { totalGrossFlowsUsd: number }).totalGrossFlowsUsd]) });
    const meta = saveReport('netting', PERIOD, payload(42));
    expect(seen).toEqual([[meta.id, 'netting', 42]]);
  });
  it('works with no sink (memory only)', () => {
    const meta = saveReport('netting', PERIOD, payload());
    expect(getReport(meta.id)).toBeDefined();
  });
});

describe('hydration', () => {
  it('restores stored reports so they can be listed (newest first) and read', () => {
    const mk = (id: string, at: string): StoredReport => ({
      metadata: { id, type: 'cash_flow', period: PERIOD, generatedAt: at, sizeBytes: 10 }, payload: payload(),
    });
    hydrateReports([mk('old', '2026-01-01T00:00:00Z'), mk('new', '2026-02-01T00:00:00Z')]);
    expect(listReports().map((r) => r.id)).toEqual(['new', 'old']);
    expect(getReport('old')?.metadata.id).toBe('old');
  });
  it('replaces what was in memory rather than adding to it', () => {
    saveReport('netting', PERIOD, payload());
    hydrateReports([]);
    expect(listReports()).toEqual([]);
  });
});

describe('configuration guard', () => {
  it('refuses to start in production without a database', () => {
    expect(() => assertPersistenceConfigured({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/refuses to start/);
    expect(() => assertPersistenceConfigured({ NODE_ENV: 'production', DB_HOST: 'h' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(() => assertPersistenceConfigured({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
    expect(isDbEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? describe : describe.skip;

dbSuite('against a real database', () => {
  let p: typeof import('../persistence');
  const wait = () => new Promise((r) => setTimeout(r, 400));

  beforeAll(async () => { p = await import('../persistence'); await p.runMigrations(); await p.clearStoredReports(); });
  afterAll(async () => { p.detachPersistence(); await p.clearStoredReports(); await p.closePool(); });

  it('keeps a report across a restart, can fetch one that is not in memory, and deletes durably', async () => {
    await p.initPersistence();
    const meta = saveReport('cash_flow', PERIOD, payload(7));
    await wait();

    p.detachPersistence(); clearReports();               // the pod restarts
    await p.initPersistence();
    expect(listReports().map((r) => r.id)).toContain(meta.id);
    expect((getReport(meta.id)?.payload as unknown as { totalGrossFlowsUsd: number }).totalGrossFlowsUsd).toBe(7);

    clearReports();                                      // now it is only in the database
    expect(getReport(meta.id)).toBeUndefined();
    expect((await p.fetchStoredReport(meta.id))?.metadata.id).toBe(meta.id);

    expect(await p.removeStoredReport(meta.id)).toBe(true);
    expect(await p.fetchStoredReport(meta.id)).toBeUndefined();
    expect(await p.removeStoredReport(meta.id)).toBe(false);
  });
});
