/**
 * The webhook outbox is durable: an event queued but not yet sent, an endpoint, and a rotated secret all survive a restart, and
 * the delivery goes out afterwards. Unit tests cover the hooks; the database test (skipped without DATABASE_URL, run in CI
 * against Postgres) restarts for real.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  __resetWebhooks, deriveSecret, emitEvent, hydrateWebhooks, listDeliveries, listEndpoints, processDue, registerEndpoint, removeEndpoint,
  rotateSecret, setWebhookPersistence, verifySignature, type WebhookDelivery, type WebhookEndpoint,
} from './webhooks';

const SAVED = { ...process.env };
beforeEach(() => { process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true'; __resetWebhooks(); });
afterEach(() => { process.env = { ...SAVED }; });

describe('write-through hooks', () => {
  it('saves an endpoint when registered, rotated and removed, and every delivery state change', async () => {
    const calls: string[] = [];
    setWebhookPersistence({
      saveEndpoint: async (e) => { calls.push(`endpoint:${e.secretVersion}`); },
      removeEndpoint: async () => { calls.push('removed'); },
      saveDelivery: async (d) => { calls.push(`delivery:${d.status}`); },
    });
    const reg = await registerEndpoint('inst', 'http://127.0.0.1:9/h', undefined);
    if (!reg.ok) throw new Error('expected ok');
    await rotateSecret(reg.endpoint.id);
    await emitEvent('inst', 'dispute.opened', {});
    await removeEndpoint(reg.endpoint.id);
    expect(calls).toEqual(['endpoint:1', 'endpoint:2', 'delivery:pending', 'delivery:failed', 'removed']);
  });
});

describe('hydration', () => {
  it('restores endpoints and deliveries, keeping the rotated secret version', () => {
    const e: WebhookEndpoint = { id: 'wh_x', contributorId: 'i', url: 'https://h.example.org/x', events: ['dispute.opened'], secretVersion: 3, status: 'active', consecutiveFailedDeliveries: 0, createdAt: new Date().toISOString() };
    const d: WebhookDelivery = { id: 'd1', endpointId: 'wh_x', contributorId: 'i', event: 'dispute.opened', body: '{}', status: 'pending', attempts: 0, nextAttemptAt: 0, createdAt: new Date().toISOString() };
    hydrateWebhooks({ endpoints: [e], deliveries: [d] });
    expect(listEndpoints('i')[0]!.secretVersion).toBe(3);
    expect(listDeliveries('i')[0]!.id).toBe('d1');
    expect(deriveSecret('wh_x', 3)).not.toBe(deriveSecret('wh_x', 1));
  });
});

const HAS_DB = Boolean(process.env['DATABASE_URL'] || process.env['DB_HOST']);
const dbSuite = HAS_DB ? describe : describe.skip;

dbSuite('against a real database', () => {
  type Store = typeof import('./store');
  type Db = typeof import('./db');
  let store: Store; let db: Db;
  let hits: Array<{ headers: http.IncomingHttpHeaders; body: string }> = [];
  let server: http.Server; let base: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = ''; req.on('data', (c) => { body += c; });
      req.on('end', () => { hits.push({ headers: req.headers, body }); res.statusCode = 200; res.end('ok'); });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    store = await import('./store'); db = await import('./db');
    await store.initPersistence();
    await db.pool.query('TRUNCATE webhook_endpoints, webhook_deliveries');
  });
  afterAll(async () => {
    setWebhookPersistence(null);
    await db.pool.query('TRUNCATE webhook_endpoints, webhook_deliveries');
    await db.pool.end();
    await new Promise((r) => server.close(r));
  });

  it('sends a delivery that was queued before a restart, signed with the rotated secret', async () => {
    process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true';
    await store.initPersistence();                                  // installs the write-through hook
    const reg = await registerEndpoint('inst-restart', base + '/h', undefined);
    if (!reg.ok) throw new Error('expected ok');
    const rotated = (await rotateSecret(reg.endpoint.id))!;
    await emitEvent('inst-restart', 'dispute.opened', { disputeId: 'd-restart' });   // queued, not sent
    expect(hits).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 500));

    __resetWebhooks();                                              // the pod restarts: memory is gone
    expect(listDeliveries('inst-restart')).toHaveLength(0);
    await store.initPersistence();

    expect(listEndpoints('inst-restart')[0]!.secretVersion).toBe(2);
    expect(listDeliveries('inst-restart')[0]!.status).toBe('pending');
    expect(await processDue(Date.now() + 1000)).toBe(1);
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect(verifySignature(rotated, String(h.headers['x-forge-timestamp']), String(h.headers['x-forge-signature']), h.body)).toBe(true);
    expect(JSON.parse(h.body).data.disputeId).toBe('d-restart');

    await new Promise((r) => setTimeout(r, 500));
    __resetWebhooks(); await store.initPersistence();               // and once delivered it is not sent again
    expect(listDeliveries('inst-restart')[0]!.status).toBe('delivered');
    expect(await processDue(Date.now() + 1000)).toBe(0);
    expect(hits).toHaveLength(1);
  });
});
