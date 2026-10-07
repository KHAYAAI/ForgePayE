/**
 * Webhooks to institutions.
 *
 * Until this existed the bureau could only be polled. A furnisher whose data was disputed or corrected learned of it only by
 * asking (the dispute code said "notification pending, no delivery transport wired"). Now an institution registers an HTTPS
 * endpoint and the bureau pushes events to it:
 *
 *   dispute.opened      a dispute was filed against an event you furnished
 *   dispute.resolved    that dispute was resolved (upheld, corrected or deleted); says whether your data changed
 *   agent.tier_changed  an agent you furnished for moved to a different tier
 *   webhook.test        sent on request, to check an endpoint
 *
 * Properties that matter and are tested:
 *  - Signed. `X-Forge-Signature: v1=<hex>` is HMAC-SHA256 of `<timestamp>.<body>` with the endpoint's secret; the timestamp
 *    is signed too, so a captured delivery cannot be replayed later. Secrets are derived from a master key and the endpoint id
 *    (never stored); rotating one changes its version.
 *  - Durable. Each delivery is written to an outbox before it is attempted and survives a restart; retries back off over about
 *    seven hours, then the delivery is marked failed (it can be redelivered), and an endpoint that keeps failing is disabled.
 *  - Safe to point at. The target must be https (in production), carry no credentials, and resolve only to public addresses,
 *    checked when registered AND again at connect time (so a DNS change after registration cannot aim the bureau at an internal
 *    address). Redirects are not followed.
 *  - At least once. A receiver can see the same delivery twice (a retry after a timeout); `X-Forge-Delivery` is the idempotency key.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

export const WEBHOOK_EVENTS = ['dispute.opened', 'dispute.resolved', 'agent.tier_changed', 'webhook.test'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export const MAX_ENDPOINTS_PER_INSTITUTION = 5;
/** Seconds to wait before attempt n+1 after attempt n failed (attempt 0 is immediate). About 7h in total. */
export const RETRY_SCHEDULE_SECONDS = [30, 120, 600, 3600, 21_600];
export const MAX_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length + 1;
export const DISABLE_AFTER_CONSECUTIVE_FAILED_DELIVERIES = 5;
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;
const requestTimeoutMs = (env: NodeJS.ProcessEnv): number => {
  const n = parseInt(env['WEBHOOK_TIMEOUT_MS'] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REQUEST_TIMEOUT_MS;
};
const SIGNATURE_TOLERANCE_SECONDS = 300;

export interface WebhookEndpoint {
  id: string;
  contributorId: string;
  url: string;
  events: WebhookEventType[];
  secretVersion: number;
  status: 'active' | 'disabled';
  disabledReason?: string;
  consecutiveFailedDeliveries: number;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  contributorId: string;
  event: WebhookEventType;
  /** The exact JSON body that is signed and sent. */
  body: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextAttemptAt: number;     // epoch ms
  createdAt: string;
  deliveredAt?: string;
  lastStatus?: number;       // HTTP status of the last attempt, if any
  lastError?: string;
}

// ── State and persistence hook ────────────────────────────────────────────────

const endpoints = new Map<string, WebhookEndpoint>();
const deliveries = new Map<string, WebhookDelivery>();

export interface WebhookPersistence {
  saveEndpoint(e: WebhookEndpoint): Promise<void>;
  removeEndpoint(id: string): Promise<void>;
  saveDelivery(d: WebhookDelivery): Promise<void>;
}
let persistence: WebhookPersistence | null = null;
export function setWebhookPersistence(p: WebhookPersistence | null): void { persistence = p; }

export function hydrateWebhooks(rows: { endpoints: WebhookEndpoint[]; deliveries: WebhookDelivery[] }): void {
  endpoints.clear(); deliveries.clear();
  for (const e of rows.endpoints) endpoints.set(e.id, e);
  for (const d of rows.deliveries) deliveries.set(d.id, d);
}

/** Test helper. */
export function __resetWebhooks(): void { endpoints.clear(); deliveries.clear(); persistence = null; }

const saveEndpoint = (e: WebhookEndpoint): Promise<void> => persistence?.saveEndpoint(e) ?? Promise.resolve();
const saveDelivery = (d: WebhookDelivery): Promise<void> => persistence?.saveDelivery(d) ?? Promise.resolve();

// ── Secrets and signatures ────────────────────────────────────────────────────

const DEV_MASTER = 'dev-webhook-signing-master-key-not-for-production';

export function getMasterKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = env['WEBHOOK_SIGNING_MASTER'];
  if (env['NODE_ENV'] === 'production') {
    if (!key || key.length < 32 || key === DEV_MASTER) {
      throw new Error('WEBHOOK_SIGNING_MASTER must be set to a random value of at least 32 characters in production (openssl rand -hex 32).');
    }
  }
  return key || DEV_MASTER;
}

/** Fail at startup, not on the first delivery, when production has no usable master key. */
export function assertWebhookConfig(env: NodeJS.ProcessEnv = process.env): void { getMasterKey(env); }

export function deriveSecret(endpointId: string, secretVersion: number, env: NodeJS.ProcessEnv = process.env): string {
  return 'whsec_' + createHmac('sha256', getMasterKey(env)).update(`${endpointId}:${secretVersion}`).digest('hex');
}

export function sign(secret: string, timestamp: number, body: string): string {
  return 'v1=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

/** What a receiver should do. Exported so tests prove it works and the guide can show it. */
export function verifySignature(
  secret: string, timestampHeader: string, signatureHeader: string, body: string,
  nowMs = Date.now(), toleranceSeconds = SIGNATURE_TOLERANCE_SECONDS,
): boolean {
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false;
  const expected = Buffer.from(sign(secret, ts, body));
  const given = Buffer.from(signatureHeader ?? '');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

// ── Where a webhook may point ─────────────────────────────────────────────────

/** True for any address a public webhook must not reach: private, loopback, link-local (including cloud metadata), CGNAT, multicast, reserved. */
export function isBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]!);
    return (
      lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe8') ||
      lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('ff') || lower.startsWith('64:ff9b')
    );
  }
  return true; // not an address at all
}

/** Private targets are for local tests only, and never honoured in production. */
function privateTargetsAllowed(env: NodeJS.ProcessEnv): boolean {
  return env['NODE_ENV'] !== 'production' && env['WEBHOOK_ALLOW_PRIVATE_TARGETS'] === 'true';
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; message: string };

/** Static checks on the URL itself (no DNS). */
export function checkWebhookUrl(raw: unknown, env: NodeJS.ProcessEnv = process.env): UrlCheck {
  if (typeof raw !== 'string' || raw.length > 2000) return { ok: false, message: 'url must be a string of at most 2000 characters.' };
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, message: 'url is not a valid URL.' }; }
  const allowPrivate = privateTargetsAllowed(env);
  if (url.protocol !== 'https:' && !(allowPrivate && url.protocol === 'http:')) {
    return { ok: false, message: 'url must use https.' };
  }
  if (url.username || url.password) return { ok: false, message: 'url must not contain credentials.' };
  if (!allowPrivate) {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
      return { ok: false, message: 'url must point at a public host.' };
    }
    if (net.isIP(host) && isBlockedAddress(host)) return { ok: false, message: 'url must point at a public address.' };
  }
  return { ok: true, url };
}

/** DNS lookup that refuses non-public answers. Used as the connection's own lookup, so the check holds at connect time. */
export function guardedLookup(env: NodeJS.ProcessEnv = process.env): typeof dns.lookup {
  const allowPrivate = privateTargetsAllowed(env);
  const lookup = ((hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (err: Error | null, address?: unknown, family?: number) => void;
    const opts = (typeof options === 'object' && options !== null ? options : {}) as dns.LookupOptions;
    dns.lookup(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const list = addresses as dns.LookupAddress[];
      if (!allowPrivate && list.some((a) => isBlockedAddress(a.address))) {
        return cb(new Error(`blocked: ${hostname} resolves to a non-public address`));
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0]!.address, list[0]!.family);
    });
  }) as unknown as typeof dns.lookup;
  return lookup;
}

/** Resolve a hostname now and say whether every answer is public (used when registering, for a clear early error). */
export async function resolvesPublic(hostname: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (privateTargetsAllowed(env)) return true;
  const host = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return !isBlockedAddress(host);
  try {
    const answers = await dns.promises.lookup(host, { all: true });
    return answers.length > 0 && answers.every((a) => !isBlockedAddress(a.address));
  } catch {
    return false;
  }
}

// ── Registering endpoints ─────────────────────────────────────────────────────

export function listEndpoints(contributorId: string): WebhookEndpoint[] {
  return [...endpoints.values()].filter((e) => e.contributorId === contributorId);
}

export function getEndpoint(id: string): WebhookEndpoint | undefined { return endpoints.get(id); }

export type RegisterResult =
  | { ok: true; endpoint: WebhookEndpoint; secret: string }
  | { ok: false; status: number; error: string; message: string };

export async function registerEndpoint(
  contributorId: string, rawUrl: unknown, rawEvents: unknown, env: NodeJS.ProcessEnv = process.env,
): Promise<RegisterResult> {
  const checked = checkWebhookUrl(rawUrl, env);
  if (!checked.ok) return { ok: false, status: 400, error: 'ValidationError', message: checked.message };

  let events: WebhookEventType[] = WEBHOOK_EVENTS.filter((e) => e !== 'webhook.test');
  if (rawEvents !== undefined) {
    if (!Array.isArray(rawEvents) || rawEvents.length === 0 || !rawEvents.every((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e))) {
      return { ok: false, status: 400, error: 'ValidationError', message: `events must be a non-empty list from: ${WEBHOOK_EVENTS.join(', ')}.` };
    }
    events = [...new Set(rawEvents as WebhookEventType[])];
  }
  if (listEndpoints(contributorId).length >= MAX_ENDPOINTS_PER_INSTITUTION) {
    return { ok: false, status: 409, error: 'TooManyEndpoints', message: `At most ${MAX_ENDPOINTS_PER_INSTITUTION} endpoints per institution. Remove one first.` };
  }
  if (!(await resolvesPublic(checked.url.hostname, env))) {
    return { ok: false, status: 400, error: 'ValidationError', message: 'url must resolve to a public address.' };
  }

  const endpoint: WebhookEndpoint = {
    id: `wh_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    contributorId, url: checked.url.toString(), events, secretVersion: 1, status: 'active',
    consecutiveFailedDeliveries: 0, createdAt: new Date().toISOString(),
  };
  endpoints.set(endpoint.id, endpoint);
  await saveEndpoint(endpoint);
  return { ok: true, endpoint, secret: deriveSecret(endpoint.id, endpoint.secretVersion, env) };
}

export async function removeEndpoint(id: string): Promise<boolean> {
  const removed = endpoints.delete(id);
  if (removed) {
    for (const [did, d] of deliveries) if (d.endpointId === id && d.status === 'pending') { d.status = 'failed'; d.lastError = 'endpoint removed'; await saveDelivery(d); deliveries.set(did, d); }
    await persistence?.removeEndpoint(id);
  }
  return removed;
}

export async function rotateSecret(id: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const e = endpoints.get(id);
  if (!e) return null;
  e.secretVersion += 1;
  await saveEndpoint(e);
  return deriveSecret(e.id, e.secretVersion, env);
}

export async function enableEndpoint(id: string): Promise<WebhookEndpoint | null> {
  const e = endpoints.get(id);
  if (!e) return null;
  e.status = 'active'; e.disabledReason = undefined; e.consecutiveFailedDeliveries = 0;
  await saveEndpoint(e);
  return e;
}

// ── Emitting events into the outbox ───────────────────────────────────────────

/**
 * Queue an event for every active endpoint of `contributorId` that subscribed to it. Resolves once the deliveries are in the
 * outbox (and stored, when persistence is on), not once they are sent: the caller's request is never held up by a slow receiver.
 */
export async function emitEvent(contributorId: string, type: WebhookEventType, data: unknown, now = Date.now()): Promise<number> {
  const targets = listEndpoints(contributorId).filter((e) => e.status === 'active' && e.events.includes(type));
  for (const endpoint of targets) {
    const id = randomUUID();
    const createdAt = new Date(now).toISOString();
    const body = JSON.stringify({ id, type, createdAt, data });
    const delivery: WebhookDelivery = {
      id, endpointId: endpoint.id, contributorId, event: type, body, status: 'pending', attempts: 0, nextAttemptAt: now, createdAt,
    };
    deliveries.set(id, delivery);
    await saveDelivery(delivery);
  }
  return targets.length;
}

export function listDeliveries(contributorId: string, limit = 50): WebhookDelivery[] {
  return [...deliveries.values()]
    .filter((d) => d.contributorId === contributorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.min(limit, 200));
}

export function getDelivery(id: string): WebhookDelivery | undefined { return deliveries.get(id); }

export async function redeliver(id: string, now = Date.now()): Promise<WebhookDelivery | null> {
  const d = deliveries.get(id);
  if (!d || d.status === 'pending') return d ?? null;
  d.status = 'pending'; d.attempts = 0; d.nextAttemptAt = now; d.lastError = undefined; d.lastStatus = undefined; d.deliveredAt = undefined;
  await saveDelivery(d);
  return d;
}

// ── Sending ───────────────────────────────────────────────────────────────────

interface SendResult { status?: number; error?: string }

/** One HTTP attempt. Does not follow redirects, times out, and connects only to addresses the guard allows. */
export function postJson(url: URL, headers: Record<string, string>, body: string, env: NodeJS.ProcessEnv = process.env): Promise<SendResult> {
  return new Promise((resolve) => {
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'POST', headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() }, timeout: requestTimeoutMs(env), lookup: guardedLookup(env) },
      (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode })); res.on('error', (e) => resolve({ error: e.message })); },
    );
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => resolve({ error: e.message }));
    req.end(body);
  });
}

function nextDelay(attemptsMade: number): number | null {
  const idx = attemptsMade - 1; // after attempt 1 -> schedule[0]
  return idx < RETRY_SCHEDULE_SECONDS.length ? RETRY_SCHEDULE_SECONDS[idx]! * 1000 : null;
}

/** Attempt one delivery and record the outcome. */
export async function attemptDelivery(d: WebhookDelivery, now = Date.now(), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const endpoint = endpoints.get(d.endpointId);
  if (!endpoint || endpoint.status !== 'active') {
    d.status = 'failed'; d.lastError = endpoint ? 'endpoint disabled' : 'endpoint removed';
    await saveDelivery(d);
    return;
  }
  const check = checkWebhookUrl(endpoint.url, env);
  const timestamp = Math.floor(now / 1000);
  const result: SendResult = check.ok
    ? await postJson(check.url, {
        'content-type': 'application/json',
        'user-agent': 'forge-bureau-webhooks/1',
        'x-forge-event': d.event,
        'x-forge-delivery': d.id,
        'x-forge-timestamp': String(timestamp),
        'x-forge-signature': sign(deriveSecret(endpoint.id, endpoint.secretVersion, env), timestamp, d.body),
      }, d.body, env)
    : { error: check.message };

  d.attempts += 1;
  d.lastStatus = result.status;
  const success = result.status !== undefined && result.status >= 200 && result.status < 300;
  if (success) {
    d.status = 'delivered'; d.deliveredAt = new Date(now).toISOString(); d.lastError = undefined;
    if (endpoint.consecutiveFailedDeliveries !== 0) { endpoint.consecutiveFailedDeliveries = 0; await saveEndpoint(endpoint); }
  } else {
    d.lastError = result.error ?? `HTTP ${result.status}`;
    const delay = nextDelay(d.attempts);
    if (delay === null) {
      d.status = 'failed';
      endpoint.consecutiveFailedDeliveries += 1;
      if (endpoint.consecutiveFailedDeliveries >= DISABLE_AFTER_CONSECUTIVE_FAILED_DELIVERIES) {
        endpoint.status = 'disabled';
        endpoint.disabledReason = `${endpoint.consecutiveFailedDeliveries} deliveries in a row failed after every retry`;
      }
      await saveEndpoint(endpoint);
    } else {
      d.nextAttemptAt = now + delay;
    }
  }
  await saveDelivery(d);
}

/** Send everything that is due. Returns how many attempts were made. Called by the worker; callable directly in tests. */
export async function processDue(now = Date.now(), batch = 25, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const due = [...deliveries.values()]
    .filter((d) => d.status === 'pending' && d.nextAttemptAt <= now)
    .sort((a, b) => a.nextAttemptAt - b.nextAttemptAt)
    .slice(0, batch);
  await Promise.all(due.map((d) => attemptDelivery(d, now, env)));
  return due.length;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startWebhookWorker(intervalMs = 2000): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    processDue().catch((e) => console.error('[webhooks] worker error', e)).finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
}

export function stopWebhookWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Public view of an endpoint (never a secret). */
export function endpointView(e: WebhookEndpoint): Omit<WebhookEndpoint, 'secretVersion'> & { secretVersion: number } {
  return { ...e };
}

