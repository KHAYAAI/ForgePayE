/**
 * openfireblocks adapter — the backend behind FORGE Custody
 * (services/openfireblocks). One openfireblocks customer per FORGE tenant,
 * using the tenant id as the customer id, so there is no mapping to store.
 *
 * The console calls openfireblocks' admin-scoped custody API with its admin
 * key and names the person acting (`x-actor-email`); openfireblocks decides
 * whether that person may act (active signer, past cooling-off) and audits
 * every action under their name.
 */

const OFB_URL = process.env.OPENFIREBLOCKS_URL ?? 'http://localhost:8090';
const TIMEOUT_MS = 8000;
// Actions that sign wait for a 2-of-3 threshold signature (a few seconds each), and transfers for one
// address sign one after another, so a burst of transfers queues; 8s would report success as failure.
// A vote that completes a key re-split runs the whole reshare (protocol, test signature, commit),
// which the signer bounds at about nine minutes; cutting it short would report a working re-split as failed.
const ACTION_TIMEOUT_MS = 10 * 60_000;

function adminKey(): string {
  const key = process.env.OPENFIREBLOCKS_ADMIN_KEY;
  if (!key) throw new Error('OPENFIREBLOCKS_ADMIN_KEY is not set');
  return key;
}

export class OpenFireblocksError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Sign a custody request so the service can tell the console (not just anyone with the admin key) is
 * asserting this actor for this exact request. Must match src/auth/actor-assertion.ts in the service.
 */
export function actorAssertion(secret: string, actor: string, method: string, path: string, rawBody: string | undefined, now = Date.now()): string {
  let parsed: unknown = undefined;
  try { parsed = rawBody ? JSON.parse(rawBody) : undefined; } catch { parsed = rawBody; }
  const empty = parsed === undefined || parsed === null || parsed === '' || (typeof parsed === 'object' && Object.keys(parsed as object).length === 0);
  const body = createHash('sha256').update(empty ? '' : typeof parsed === 'string' ? parsed : JSON.stringify(parsed)).digest('hex');
  const ts = String(now);
  const nonce = randomBytes(12).toString('hex');
  const sig = createHmac('sha256', secret).update(['v1', ts, nonce, actor.toLowerCase(), method.toUpperCase(), path, body].join('\n')).digest('hex');
  return `v1.${ts}.${nonce}.${sig}`;
}

async function call<T>(path: string, init: RequestInit = {}, actor?: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${OFB_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${adminKey()}`,
      'content-type': 'application/json',
      ...(actor ? { 'x-actor-email': actor } : {}),
      ...(process.env.CUSTODY_ACTOR_SECRET && (actor || (init.method ?? 'GET').toUpperCase() !== 'GET')
        ? { 'x-actor-assertion': actorAssertion(process.env.CUSTODY_ACTOR_SECRET, actor ?? '', init.method ?? 'GET', path.split('?')[0]!, typeof init.body === 'string' ? init.body : undefined) }
        : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join('; ') : body?.message ?? body?.error ?? `HTTP ${res.status}`;
    throw new OpenFireblocksError(res.status, message);
  }
  return body as T;
}

const ws = (tenantId: string) => `/admin/customers/${encodeURIComponent(tenantId)}`;

/**
 * Provision this tenant's workspace on first use. Pro tier: the free tier's
 * 10 ETH cap sits exactly at the approval threshold, so free workspaces could
 * never produce a transfer that needs approval.
 */
export async function ensureWorkspace(tenantId: string): Promise<void> {
  try {
    await call(ws(tenantId));
  } catch (err) {
    if (!(err instanceof OpenFireblocksError) || err.status !== 404) throw err;
    await call('/admin/customers', {
      method: 'POST',
      body: JSON.stringify({ customerId: tenantId, email: `tenant-${tenantId}@forge.internal`, tier: 'pro' }),
    });
  }
}

export async function getCustodyConsole(tenantId: string): Promise<{ live: boolean; data: unknown; error?: string }> {
  try {
    await ensureWorkspace(tenantId);
    return { live: true, data: await call(`${ws(tenantId)}/custody/console`) };
  } catch (err) {
    return { live: false, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export type CustodyAction =
  | { action: 'bootstrap_signer'; name?: string }
  | { action: 'propose'; kind: 'add_signer' | 'remove_signer' | 'set_threshold' | 'rotate_key'; payload: Record<string, unknown> }
  | { action: 'vote'; proposalId: string; approve: boolean; signature?: string }
  | { action: 'retry_transfer'; proposalId: string }
  | { action: 'retire_stale' }
  | { action: 'transfer'; to: string; amountEth: string }
  | { action: 'rebroadcast'; requestId: string }
  | { action: 'issue_api_key'; name: string }
  | { action: 'revoke_api_key'; keyId: string };

/** Perform one custody action as `actor` (the signed-in console user). */
export async function performCustodyAction(tenantId: string, actor: string, a: CustodyAction): Promise<unknown> {
  await ensureWorkspace(tenantId);
  const base = `${ws(tenantId)}/custody`;
  const post = (path: string, body: unknown) =>
    call(`${base}${path}`, { method: 'POST', body: JSON.stringify(body) }, actor, ACTION_TIMEOUT_MS);

  switch (a.action) {
    case 'bootstrap_signer':
      // The bootstrap signer is always the person clicking — never someone else.
      return post('/signers/bootstrap', { email: actor, name: a.name });
    case 'propose':
      return post('/proposals', { kind: a.kind, payload: a.payload });
    case 'vote':
      return post(`/proposals/${encodeURIComponent(a.proposalId)}/votes`, { approve: a.approve, ...(a.signature ? { signature: a.signature } : {}) });
    case 'retire_stale':
      return post('/keys/retire-stale', {});
    case 'retry_transfer':
      return post(`/proposals/${encodeURIComponent(a.proposalId)}/retry`, {});
    case 'transfer':
      return post('/transfers', { to: a.to, amountEth: a.amountEth });
    case 'rebroadcast':
      // Resends the same signed bytes; never signs again.
      return post(`/transfers/${encodeURIComponent(a.requestId)}/rebroadcast`, {});
    case 'issue_api_key':
      return post('/api-keys', { name: a.name });
    case 'revoke_api_key':
      return call(`${base}/api-keys/${encodeURIComponent(a.keyId)}`, { method: 'DELETE' }, actor);
  }
}
