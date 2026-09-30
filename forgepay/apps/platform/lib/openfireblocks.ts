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
const ACTION_TIMEOUT_MS = 90_000;

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

async function call<T>(path: string, init: RequestInit = {}, actor?: string, timeoutMs = TIMEOUT_MS): Promise<T> {
  const res = await fetch(`${OFB_URL}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${adminKey()}`,
      'content-type': 'application/json',
      ...(actor ? { 'x-actor-email': actor } : {}),
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
  | { action: 'propose'; kind: 'add_signer' | 'remove_signer' | 'set_threshold'; payload: Record<string, unknown> }
  | { action: 'vote'; proposalId: string; approve: boolean }
  | { action: 'retry_transfer'; proposalId: string }
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
      return post(`/proposals/${encodeURIComponent(a.proposalId)}/votes`, { approve: a.approve });
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
