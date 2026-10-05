/**
 * KYC must never approve on a screen it could not run, or on an identity
 * check whose result it did not read.
 *
 * Regressions guarded: sanctions screening was a stub returning "no match"
 * for everyone; the Onfido handler approved on status "complete" whatever the
 * result; and that handler was not routed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { screenName, type ScreeningConfig } from '../lib/sanctions-screen.js';
import { verifyOnfidoSignature, decisionForCheckResult } from '../lib/onfido.js';
import { KycAmlManager } from '../lib/kyc-aml-manager.js';

const cfg: ScreeningConfig = { baseUrl: 'http://cm', apiKey: 'k', maxAgeHours: 48, matchScore: 0.95, searchThreshold: 0.85 };

function fakeFetch(routes: Record<string, unknown>, fail = false): typeof fetch {
  return (async (input: string | URL | Request) => {
    if (fail) throw new Error('connect ECONNREFUSED');
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

const freshLists = [
  { list_name: 'OFAC_SDN', entry_count: 12000, age_hours: 3 },
  { list_name: 'EU_CONSOLIDATED', entry_count: 4000, age_hours: 5 },
];

describe('screenName', () => {
  it('is clear only when every list is loaded and fresh and nothing matches', async () => {
    const r = await screenName('Jane Doe', cfg, fakeFetch({ '/lists': freshLists, '/search': [] }));
    expect(r.outcome).toBe('clear');
  });

  it('is unavailable when a list is empty — an empty search is not a clear result', async () => {
    const lists = [{ list_name: 'OFAC_SDN', entry_count: 0, age_hours: 1 }];
    const r = await screenName('Jane Doe', cfg, fakeFetch({ '/lists': lists, '/search': [] }));
    expect(r.outcome).toBe('unavailable');
  });

  it('is unavailable when a list is stale', async () => {
    const lists = [{ list_name: 'OFAC_SDN', entry_count: 10, age_hours: 200 }];
    expect((await screenName('Jane Doe', cfg, fakeFetch({ '/lists': lists }))).outcome).toBe('unavailable');
  });

  it('is unavailable when compliance-monitor is unreachable or unconfigured', async () => {
    expect((await screenName('Jane Doe', cfg, fakeFetch({}, true))).outcome).toBe('unavailable');
    expect((await screenName('Jane Doe', { ...cfg, baseUrl: undefined })).outcome).toBe('unavailable');
  });

  it('separates a strong match from a possible one', async () => {
    const hit = (s: number) => [{ list_name: 'OFAC_SDN', matched_name: 'X', similarity_score: s }];
    expect((await screenName('X', cfg, fakeFetch({ '/lists': freshLists, '/search': hit(0.97) }))).outcome).toBe('match');
    expect((await screenName('X', cfg, fakeFetch({ '/lists': freshLists, '/search': hit(0.88) }))).outcome).toBe('possible_match');
  });
});

describe('Onfido', () => {
  it('accepts only a correct HMAC-SHA256 of the raw body', () => {
    const body = Buffer.from('{"payload":{}}');
    const sig = createHmac('sha256', 'tok').update(body).digest('hex');
    expect(verifyOnfidoSignature(body, sig, 'tok')).toBe(true);
    expect(verifyOnfidoSignature(Buffer.from('{"payload":1}'), sig, 'tok')).toBe(false);
    expect(verifyOnfidoSignature(body, sig, undefined)).toBe(false);
    expect(verifyOnfidoSignature(body, undefined, 'tok')).toBe(false);
  });

  it('approves only a clear result', () => {
    expect(decisionForCheckResult('clear')).toBe('approved');
    expect(decisionForCheckResult('consider')).toBe('requires_review');
    expect(decisionForCheckResult(null)).toBe('requires_review');
  });
});

/** Minimal Pool: one KYC row, records UPDATEs. */
function fakeDb(sanctionsOutcome: string) {
  const updates: Array<{ sql: string; params: unknown[] }> = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith('SELECT id, account_id, sanctions_outcome')) {
        return { rows: [{ id: 'v1', account_id: 'a1', sanctions_outcome: sanctionsOutcome }] };
      }
      updates.push({ sql, params });
      return { rows: [] };
    },
  } as unknown as Pool;
  return { db, updates };
}

const completed = { payload: { resource_type: 'check', action: 'check.completed', object: { id: 'chk_1', status: 'complete' } } };

describe('KycAmlManager.handleOnfidoWebhook', () => {
  const env = process.env['NODE_ENV'];
  afterEach(() => { process.env['NODE_ENV'] = env; });

  async function run(result: string, sanctions: string) {
    const { db, updates } = fakeDb(sanctions);
    const kyc = new KycAmlManager(db, 'onfido_key', true, cfg, fakeFetch({ '/checks/chk_1': { status: 'complete', result } }));
    await kyc.handleOnfidoWebhook(completed);
    return updates.find((u) => u.sql.startsWith('UPDATE fp_accounts'))?.params[0];
  }

  it('approves a clear check on a clear screen', async () => {
    expect(await run('clear', 'clear')).toBe('approved');
  });

  it('a completed check with result "consider" is NOT approved (the old bug)', async () => {
    expect(await run('consider', 'clear')).toBe('requires_review');
  });

  it('a clear check cannot approve someone whose screening was unavailable or a possible match', async () => {
    expect(await run('clear', 'unavailable')).toBe('requires_review');
    expect(await run('clear', 'possible_match')).toBe('requires_review');
  });

  it('in production an unscreened applicant is never approved', async () => {
    process.env['NODE_ENV'] = 'production';
    expect(await run('clear', 'not_screened')).toBe('requires_review');
  });
});
