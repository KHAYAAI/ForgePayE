/**
 * Webhooks to institutions: signing, where a webhook may point, the durable outbox and its retries, and the routes and events
 * through the real app. Deliveries go to a real HTTP server on localhost (allowed only because tests set the private-target flag).
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './index';
import {
  __resetWebhooks, attemptDelivery, checkWebhookUrl, deriveSecret, DISABLE_AFTER_CONSECUTIVE_FAILED_DELIVERIES, emitEvent, getMasterKey,
  guardedLookup, hydrateWebhooks, isBlockedAddress, listDeliveries, listEndpoints, MAX_ATTEMPTS, MAX_ENDPOINTS_PER_INSTITUTION, processDue,
  registerEndpoint, removeEndpoint, resolvesPublic, RETRY_SCHEDULE_SECONDS, rotateSecret, sign, verifySignature,
} from './webhooks';

const SAVED = { ...process.env };
const ADMIN = 'dev-bureau-admin-key';

// ── A receiver to deliver to ──────────────────────────────────────────────────

interface Hit { headers: http.IncomingHttpHeaders; body: string; url: string }
let hits: Hit[] = [];
let respond: (req: http.IncomingMessage, res: http.ServerResponse) => void = (_req, res) => { res.statusCode = 200; res.end('ok'); };
let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => { hits.push({ headers: req.headers, body, url: req.url ?? '' }); respond(req, res); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

beforeEach(() => {
  process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true';
  hits = [];
  respond = (_req, res) => { res.statusCode = 200; res.end('ok'); };
  __resetWebhooks();
});
afterEach(() => { process.env = { ...SAVED }; });

const T0 = Date.parse('2026-10-07T12:00:00Z');

// ── Signing ───────────────────────────────────────────────────────────────────

describe('signing', () => {
  const secret = 'whsec_test';
  const body = '{"a":1}';
  it('a receiver can verify a delivery, and only a genuine one', () => {
    const t = 1_800_000_000;
    const sig = sign(secret, t, body);
    const now = t * 1000;
    expect(verifySignature(secret, String(t), sig, body, now)).toBe(true);
    expect(verifySignature(secret, String(t), sig, body + ' ', now)).toBe(false);          // body changed
    expect(verifySignature('whsec_other', String(t), sig, body, now)).toBe(false);          // wrong secret
    expect(verifySignature(secret, String(t + 1), sig, body, now)).toBe(false);             // timestamp changed (it is signed)
    expect(verifySignature(secret, String(t), 'v1=abc', body, now)).toBe(false);            // wrong length
  });
  it('rejects a replay outside the five-minute window, in either direction', () => {
    const t = 1_800_000_000;
    const sig = sign(secret, t, body);
    expect(verifySignature(secret, String(t), sig, body, (t + 299) * 1000)).toBe(true);
    expect(verifySignature(secret, String(t), sig, body, (t + 301) * 1000)).toBe(false);
    expect(verifySignature(secret, String(t), sig, body, (t - 301) * 1000)).toBe(false);
    expect(verifySignature(secret, 'not-a-number', sig, body, t * 1000)).toBe(false);
  });
  it('secrets are derived, stable, per endpoint and per version, and production needs a real master key', () => {
    expect(deriveSecret('wh_1', 1)).toBe(deriveSecret('wh_1', 1));
    expect(deriveSecret('wh_1', 1)).not.toBe(deriveSecret('wh_2', 1));
    expect(deriveSecret('wh_1', 1)).not.toBe(deriveSecret('wh_1', 2));
    expect(deriveSecret('wh_1', 1)).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(() => getMasterKey({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toThrow(/WEBHOOK_SIGNING_MASTER/);
    expect(() => getMasterKey({ NODE_ENV: 'production', WEBHOOK_SIGNING_MASTER: 'short' } as NodeJS.ProcessEnv)).toThrow();
    expect(getMasterKey({ NODE_ENV: 'production', WEBHOOK_SIGNING_MASTER: 'x'.repeat(40) } as NodeJS.ProcessEnv)).toBe('x'.repeat(40));
    expect(() => getMasterKey({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});

// ── Where a webhook may point ─────────────────────────────────────────────────

describe('where a webhook may point', () => {
  it('blocks private, loopback, link-local (cloud metadata), CGNAT, multicast and mapped addresses; allows public ones', () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255',
      '::1', '::', 'fd00::1', 'fc00::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-ip']) {
      expect(isBlockedAddress(a), a).toBe(true);
    }
    for (const a of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
      expect(isBlockedAddress(a), a).toBe(false);
    }
  });

  it('in production: https only, no credentials, no localhost or internal names, no private literals; and the test flag is ignored', () => {
    const prod = { NODE_ENV: 'production', WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' } as NodeJS.ProcessEnv;
    expect(checkWebhookUrl('https://hooks.example.org/x', prod).ok).toBe(true);
    for (const bad of ['http://hooks.example.org/x', 'https://user:pw@hooks.example.org/x', 'https://localhost/x', 'https://svc.internal/x', 'https://a.local/x',
      'https://127.0.0.1/x', 'https://10.0.0.5/x', 'https://[::1]/x', 'https://169.254.169.254/latest', 'ftp://x.example.org', 'not a url', '']) {
      expect(checkWebhookUrl(bad, prod).ok, bad).toBe(false);
    }
  });

  it('outside production, http to localhost is allowed only with the explicit test flag', () => {
    expect(checkWebhookUrl('http://127.0.0.1:9/x', { NODE_ENV: 'test' } as NodeJS.ProcessEnv).ok).toBe(false);
    expect(checkWebhookUrl('http://127.0.0.1:9/x', { NODE_ENV: 'test', WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' } as NodeJS.ProcessEnv).ok).toBe(true);
  });

  it('refuses a name that resolves to a non-public address, at registration and at connect time', async () => {
    const strict = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    expect(await resolvesPublic('localhost', strict)).toBe(false);
    expect(await resolvesPublic('127.0.0.1', strict)).toBe(false);
    expect(await resolvesPublic('8.8.8.8', strict)).toBe(true);
    // the connection's own lookup, which is what stops a DNS answer changing after registration
    await expect(new Promise((resolve, reject) => {
      (guardedLookup(strict) as unknown as (h: string, o: object, cb: (e: Error | null, a?: unknown) => void) => void)('localhost', { all: true }, (e, a) => (e ? reject(e) : resolve(a)));
    })).rejects.toThrow(/non-public/);
  });

  it('a delivery to an address that is no longer allowed fails without sending anything', async () => {
    const reg = await registerEndpoint('inst', base + '/hook', undefined);
    if (!reg.ok) throw new Error('expected ok');
    await emitEvent('inst', 'agent.tier_changed', { x: 1 }, T0);
    process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'false';          // the target is now not allowed
    await processDue(T0);
    expect(hits).toHaveLength(0);
    expect(listDeliveries('inst')[0]!.lastError).toBeDefined();
  });
});

// ── The outbox ────────────────────────────────────────────────────────────────

describe('delivery', () => {
  async function endpoint(events?: string[]) {
    const reg = await registerEndpoint('inst', base + '/hook', events);
    if (!reg.ok) throw new Error('register failed: ' + reg.message);
    return reg;
  }

  it('queues on emit without sending, then sends a signed POST that a receiver can verify', async () => {
    const reg = await endpoint();
    const queued = await emitEvent('inst', 'dispute.opened', { disputeId: 'd1' }, T0);
    expect(queued).toBe(1);
    expect(hits).toHaveLength(0);                                      // nothing sent yet
    expect(listDeliveries('inst')[0]!.status).toBe('pending');

    expect(await processDue(T0)).toBe(1);
    expect(hits).toHaveLength(1);
    const h = hits[0]!;
    expect(h.headers['x-forge-event']).toBe('dispute.opened');
    expect(h.headers['content-type']).toBe('application/json');
    expect(verifySignature(reg.secret, String(h.headers['x-forge-timestamp']), String(h.headers['x-forge-signature']), h.body, T0)).toBe(true);
    const parsed = JSON.parse(h.body);
    expect(parsed).toMatchObject({ type: 'dispute.opened', data: { disputeId: 'd1' } });
    expect(parsed.id).toBe(h.headers['x-forge-delivery']);             // the idempotency key
    const d = listDeliveries('inst')[0]!;
    expect(d).toMatchObject({ status: 'delivered', attempts: 1, lastStatus: 200 });
  });

  it('only subscribed events reach an endpoint, and only for its own institution', async () => {
    await endpoint(['dispute.resolved']);
    expect(await emitEvent('inst', 'dispute.opened', {}, T0)).toBe(0);
    expect(await emitEvent('someone-else', 'dispute.resolved', {}, T0)).toBe(0);
    expect(await emitEvent('inst', 'dispute.resolved', {}, T0)).toBe(1);
  });

  it('retries a failure with backoff, repeating the same delivery id, and succeeds when the receiver recovers', async () => {
    await endpoint();
    let n = 0;
    respond = (_req, res) => { res.statusCode = ++n === 1 ? 500 : 200; res.end(); };
    await emitEvent('inst', 'dispute.opened', {}, T0);
    await processDue(T0);
    let d = listDeliveries('inst')[0]!;
    expect(d).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 500, nextAttemptAt: T0 + RETRY_SCHEDULE_SECONDS[0]! * 1000 });
    expect(await processDue(T0 + 10_000)).toBe(0);                      // not due yet
    expect(await processDue(T0 + 31_000)).toBe(1);
    d = listDeliveries('inst')[0]!;
    expect(d).toMatchObject({ status: 'delivered', attempts: 2 });
    expect(hits[0]!.headers['x-forge-delivery']).toBe(hits[1]!.headers['x-forge-delivery']);
  });

  it('gives up after the last retry, marks the delivery failed, and disables an endpoint that keeps failing', async () => {
    await endpoint();
    respond = (_req, res) => { res.statusCode = 503; res.end(); };
    let clock = T0;
    for (let i = 0; i < DISABLE_AFTER_CONSECUTIVE_FAILED_DELIVERIES; i++) {
      await emitEvent('inst', 'dispute.opened', { i }, clock);
      for (let a = 0; a < MAX_ATTEMPTS; a++) { await processDue(clock); clock += 7 * 3_600_000; }
    }
    const all = listDeliveries('inst', 100);
    expect(all.every((d) => d.status === 'failed' && d.attempts === MAX_ATTEMPTS)).toBe(true);
    expect(listEndpoints('inst')[0]).toMatchObject({ status: 'disabled' });
    expect(listEndpoints('inst')[0]!.disabledReason).toMatch(/failed after every retry/);
    expect(await emitEvent('inst', 'dispute.opened', {}, clock)).toBe(0);   // a disabled endpoint gets nothing new
  });

  it('a success resets the count of consecutive failures', async () => {
    await endpoint();
    respond = (_req, res) => { res.statusCode = 500; res.end(); };
    let clock = T0;
    await emitEvent('inst', 'dispute.opened', {}, clock);
    for (let a = 0; a < MAX_ATTEMPTS; a++) { await processDue(clock); clock += 7 * 3_600_000; }
    expect(listEndpoints('inst')[0]!.consecutiveFailedDeliveries).toBe(1);
    respond = (_req, res) => { res.statusCode = 200; res.end(); };
    await emitEvent('inst', 'dispute.opened', {}, clock);
    await processDue(clock);
    expect(listEndpoints('inst')[0]!.consecutiveFailedDeliveries).toBe(0);
  });

  it('does not follow a redirect (a receiver cannot bounce the bureau at an internal address)', async () => {
    await endpoint();
    respond = (_req, res) => { res.statusCode = 302; res.setHeader('location', base + '/internal'); res.end(); };
    await emitEvent('inst', 'dispute.opened', {}, T0);
    await processDue(T0);
    expect(hits.map((h) => h.url)).toEqual(['/hook']);
    expect(listDeliveries('inst')[0]!).toMatchObject({ status: 'pending', lastStatus: 302 });
  });

  it('times out a receiver that never answers', async () => {
    process.env['WEBHOOK_TIMEOUT_MS'] = '300';
    await endpoint();
    respond = () => { /* never respond */ };
    await emitEvent('inst', 'dispute.opened', {}, T0);
    const started = Date.now();
    await processDue(T0);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(listDeliveries('inst')[0]!.lastError).toMatch(/timeout|socket hang up|aborted/i);
  });

  it('removing an endpoint cancels what was queued for it', async () => {
    const reg = await endpoint();
    await emitEvent('inst', 'dispute.opened', {}, T0);
    expect(await removeEndpoint(reg.endpoint.id)).toBe(true);
    expect(await processDue(T0)).toBe(0);
    expect(hits).toHaveLength(0);
    expect(listDeliveries('inst')[0]!.status).toBe('failed');
  });

  it('rotating the secret changes the signature at once', async () => {
    const reg = await endpoint();
    const next = await rotateSecret(reg.endpoint.id);
    expect(next).not.toBe(reg.secret);
    await emitEvent('inst', 'dispute.opened', {}, T0);
    await processDue(T0);
    const h = hits[0]!;
    const args = [String(h.headers['x-forge-timestamp']), String(h.headers['x-forge-signature']), h.body, T0] as const;
    expect(verifySignature(next!, ...args)).toBe(true);
    expect(verifySignature(reg.secret, ...args)).toBe(false);
  });

  it('registration limits: five endpoints per institution, valid events only', async () => {
    for (let i = 0; i < MAX_ENDPOINTS_PER_INSTITUTION; i++) expect((await registerEndpoint('inst', `${base}/h${i}`, undefined)).ok).toBe(true);
    const sixth = await registerEndpoint('inst', base + '/h6', undefined);
    expect(sixth).toMatchObject({ ok: false, status: 409 });
    expect(await registerEndpoint('other', base + '/x', ['nonsense'])).toMatchObject({ ok: false, status: 400 });
    expect(await registerEndpoint('other', base + '/x', [])).toMatchObject({ ok: false, status: 400 });
  });

  it('an attempt on a missing or disabled endpoint fails the delivery without sending', async () => {
    await endpoint();
    await emitEvent('inst', 'dispute.opened', {}, T0);
    const d = listDeliveries('inst')[0]!;
    hydrateWebhooks({ endpoints: [], deliveries: [d] });
    await attemptDelivery(d, T0);
    expect(d.status).toBe('failed');
    expect(hits).toHaveLength(0);
  });
});

// ── Through the real app ──────────────────────────────────────────────────────

describe('routes and events', () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await buildApp(); await app.ready(); });
  afterAll(async () => { await app.close(); });
  const json = (key: string) => ({ authorization: `Bearer ${key}`, 'content-type': 'application/json' });
  const plain = (key: string) => ({ authorization: `Bearer ${key}` });

  async function institution(name: string, permissions = ['ingest_events', 'pull_scores', 'read_profile']) {
    const reg = await app.inject({ method: 'POST', url: '/v1/contributors', headers: json(ADMIN), payload: { name, type: 'cefi_lender', permissions } });
    const { id, apiKey } = reg.json().data;
    await app.inject({ method: 'PUT', url: `/v1/contributors/${id}/status`, headers: json(ADMIN), payload: { status: 'active', reason: 't' } });
    return { id: id as string, key: apiKey as string };
  }
  const register = (inst: { id: string; key: string }, url: string, events?: string[]) =>
    app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/webhooks`, headers: json(inst.key), payload: { url, events } });

  it('registers, shows the secret once, lists without it, and is private to the institution', async () => {
    const a = await institution('WH A'); const b = await institution('WH B');
    const created = await register(a, base + '/a');
    expect(created.statusCode).toBe(201);
    const { endpoint, secret } = created.json().data;
    expect(secret).toMatch(/^whsec_/);
    const list = await app.inject({ method: 'GET', url: `/v1/contributors/${a.id}/webhooks`, headers: plain(a.key) });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.endpoints.map((e: { id: string }) => e.id)).toEqual([endpoint.id]);
    expect(list.body).not.toContain(secret);
    for (const [method, url] of [['GET', `/v1/contributors/${a.id}/webhooks`], ['POST', `/v1/contributors/${a.id}/webhooks`], ['DELETE', `/v1/contributors/${a.id}/webhooks/${endpoint.id}`],
      ['GET', `/v1/contributors/${a.id}/webhook-deliveries`]] as const) {
      const res = await app.inject({ method, url, headers: method === 'POST' ? json(b.key) : plain(b.key), payload: method === 'POST' ? { url: base + '/x' } : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    // B naming A's webhook id under B's own path finds nothing
    expect((await app.inject({ method: 'DELETE', url: `/v1/contributors/${b.id}/webhooks/${endpoint.id}`, headers: plain(b.key) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: `/v1/contributors/${a.id}/webhooks/${endpoint.id}`, headers: plain(a.key) })).statusCode).toBe(200);
  });

  it('rejects an address that is not allowed, and works for a lender-only institution (self service)', async () => {
    const inst = await institution('WH Strict', ['pull_scores']);
    process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'false';
    for (const url of ['http://example.org/x', 'https://127.0.0.1/x', 'https://169.254.169.254/x', 'https://u:p@example.org/x']) {
      expect((await register(inst, url)).statusCode, url).toBe(400);
    }
    process.env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] = 'true';
    expect((await register(inst, base + '/ok')).statusCode).toBe(201);
  });

  it('a test event reaches the endpoint, and the delivery log shows the outcome but not the body', async () => {
    const inst = await institution('WH Test');
    const { endpoint, secret } = (await register(inst, base + '/t', ['dispute.opened'])).json().data;   // not subscribed to webhook.test
    const res = await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/webhooks/${endpoint.id}/test`, headers: plain(inst.key) });
    expect(res.statusCode).toBe(202);
    await processDue(Date.now());
    expect(hits).toHaveLength(1);
    expect(hits[0]!.headers['x-forge-event']).toBe('webhook.test');
    expect(verifySignature(secret, String(hits[0]!.headers['x-forge-timestamp']), String(hits[0]!.headers['x-forge-signature']), hits[0]!.body)).toBe(true);
    // and the endpoint's own subscription list was not changed by the test
    expect(listEndpoints(inst.id)[0]!.events).toEqual(['dispute.opened']);
    const log = await app.inject({ method: 'GET', url: `/v1/contributors/${inst.id}/webhook-deliveries`, headers: plain(inst.key) });
    expect(log.json().data[0]).toMatchObject({ event: 'webhook.test', status: 'delivered', attempts: 1 });
    expect(log.body).not.toContain('"body"');
  });

  it('a failed delivery can be redelivered; one still being attempted cannot', async () => {
    const inst = await institution('WH Redeliver');
    const { endpoint } = (await register(inst, base + '/r')).json().data;
    respond = (_req, res) => { res.statusCode = 500; res.end(); };
    await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/webhooks/${endpoint.id}/test`, headers: plain(inst.key) });
    const id = listDeliveries(inst.id)[0]!.id;
    expect((await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/webhook-deliveries/${id}/redeliver`, headers: plain(inst.key) })).statusCode).toBe(409);
    // run it to failure
    let clock = Date.now();
    for (let a = 0; a < MAX_ATTEMPTS; a++) { await processDue(clock); clock += 7 * 3_600_000; }
    expect(listDeliveries(inst.id)[0]!.status).toBe('failed');
    respond = (_req, res) => { res.statusCode = 200; res.end(); };
    expect((await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/webhook-deliveries/${id}/redeliver`, headers: plain(inst.key) })).statusCode).toBe(202);
    await processDue(clock);
    expect(listDeliveries(inst.id)[0]!.status).toBe('delivered');
    expect((await app.inject({ method: 'POST', url: `/v1/contributors/${inst.id}/webhook-deliveries/nope/redeliver`, headers: plain(inst.key) })).statusCode).toBe(404);
  });

  it('tells the furnisher when its data is disputed and when the dispute is resolved', async () => {
    const f = await institution('WH Furnisher');
    await register(f, base + '/f', ['dispute.opened', 'dispute.resolved']);
    const agentId = `wh_agent_${Date.now()}`;
    await app.inject({
      method: 'POST', url: `/v1/agents/${agentId}/profile`, headers: json(f.key),
      payload: { agentId, did: `did:forge:agent_${agentId}`, operatorEntityId: 'op', operatorEntityType: 'llc', operatorLegalName: 'Op Ltd' },
    });
    const ingest = await app.inject({
      method: 'POST', url: `/v1/contributors/${f.id}/ingest`, headers: json(f.key),
      payload: { agentId, events: [{ externalId: 'loan-9-pay-1', eventType: 'payment_late_90', amount: 50, description: 'instalment 1' }] },
    });
    const eventId = ingest.json().data.events[0].id as string;

    const filed = await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/disputes`, headers: json(f.key), payload: { eventId, description: 'This payment was made on time per my records.' } });
    expect(filed.statusCode).toBe(201);
    await processDue(Date.now());
    const opened = hits.map((h) => JSON.parse(h.body)).find((e) => e.type === 'dispute.opened');
    expect(opened.data).toMatchObject({ agentId, eventId, externalId: 'loan-9-pay-1' });          // the furnisher's own id, so it can match its records

    const disputeId = filed.json().data.id as string;
    await app.inject({ method: 'PUT', url: `/v1/disputes/${disputeId}`, headers: json(ADMIN), payload: { status: 'investigating' } });
    await processDue(Date.now());
    expect(hits.map((h) => JSON.parse(h.body)).some((e) => e.type === 'dispute.resolved')).toBe(false);   // investigating is not a resolution
    const resolved = await app.inject({ method: 'PUT', url: `/v1/disputes/${disputeId}`, headers: json(ADMIN), payload: { status: 'resolved_deleted', resolution: 'Evidence shows it was on time.' } });
    expect(resolved.statusCode).toBe(200);
    await processDue(Date.now());
    const done = hits.map((h) => JSON.parse(h.body)).find((e) => e.type === 'dispute.resolved');
    expect(done.data).toMatchObject({ disputeId, outcome: 'resolved_deleted', dataChanged: true });
  });

  it('tells every institution that furnished for an agent when its tier changes', async () => {
    const a = await institution('WH Tier A'); const b = await institution('WH Tier B');
    await register(a, base + '/ta', ['agent.tier_changed']);
    await register(b, base + '/tb', ['agent.tier_changed']);
    const agentId = `wh_tier_${Date.now()}`;
    await app.inject({
      method: 'POST', url: `/v1/agents/${agentId}/profile`, headers: json(a.key),
      payload: { agentId, did: `did:forge:agent_${agentId}`, operatorEntityId: 'op', operatorEntityType: 'llc', operatorLegalName: 'Op Ltd' },
    });
    const pay = (inst: { id: string; key: string }, n: number) => app.inject({
      method: 'POST', url: `/v1/contributors/${inst.id}/ingest`, headers: json(inst.key),
      payload: { agentId, events: Array.from({ length: n }, (_, i) => ({ externalId: `${inst.id}-${i}-${Date.now()}`, eventType: 'payment_on_time', amount: 10, description: 'ok' })) },
    });
    await pay(b, 1);                        // b furnishes first, so b is on the file
    hits = [];
    await pay(a, 12);                       // a's payments lift the agent out of the bottom tier
    await processDue(Date.now());
    const events = hits.map((h) => JSON.parse(h.body)).filter((e) => e.type === 'agent.tier_changed');
    expect(events.length).toBeGreaterThanOrEqual(2);                                           // a and b were both told
    expect(events[0].data).toMatchObject({ agentId });
    expect(events[0].data.from).not.toBe(events[0].data.to);
    expect(new Set(hits.map((h) => h.url))).toEqual(new Set(['/ta', '/tb']));
  });

  it('a slow or dead receiver never delays or fails the request that caused the event', async () => {
    const f = await institution('WH Slow');
    await register(f, base + '/slow', ['dispute.opened']);
    respond = () => { /* hangs */ };
    const agentId = `wh_slow_${Date.now()}`;
    await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/profile`, headers: json(f.key), payload: { agentId, did: `did:forge:agent_${agentId}`, operatorEntityId: 'op', operatorEntityType: 'llc', operatorLegalName: 'Op Ltd' } });
    const ing = await app.inject({ method: 'POST', url: `/v1/contributors/${f.id}/ingest`, headers: json(f.key), payload: { agentId, events: [{ externalId: 'x1', eventType: 'payment_on_time', description: 'ok' }] } });
    const started = Date.now();
    const filed = await app.inject({ method: 'POST', url: `/v1/agents/${agentId}/disputes`, headers: json(f.key), payload: { eventId: ing.json().data.events[0].id, description: 'Disputing this entry, please check.' } });
    expect(filed.statusCode).toBe(201);
    expect(Date.now() - started).toBeLessThan(1500);                  // nothing waited on the receiver
  });
});
