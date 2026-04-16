/**
 * Server-side Kill Bill client for Next.js API routes.
 *
 * Kill Bill runs internally; credentials come from environment variables.
 */

const KB_BASE   = process.env['KILLBILL_BASE_URL']   ?? 'http://billing-engine:8080';
const KB_USER   = process.env['KILLBILL_USERNAME']   ?? 'admin';
const KB_PASS   = process.env['KILLBILL_PASSWORD']   ?? 'password';
const KB_TENANT = process.env['KILLBILL_API_KEY']    ?? 'forgepay';
const KB_SECRET = process.env['KILLBILL_API_SECRET'] ?? 'forgepay';

function kbHeaders(): Record<string, string> {
  const basic = Buffer.from(`${KB_USER}:${KB_PASS}`).toString('base64');
  return {
    Authorization:       `Basic ${basic}`,
    'X-Killbill-ApiKey':    KB_TENANT,
    'X-Killbill-ApiSecret': KB_SECRET,
    'Content-Type':         'application/json',
    'X-Killbill-CreatedBy': 'forgepay-dashboard',
  };
}

async function kbRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${KB_BASE}${path}`, {
    method,
    headers: kbHeaders(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `Kill Bill error ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Subscriptions ─────────────────────────────────────────────────────────────

export interface KBSubscription {
  subscriptionId:  string;
  accountId:       string;
  planName:        string;
  state:           string;
  startDate:       string;
  chargedThroughDate: string | null;
  cancelledDate:   string | null;
}

export async function listSubscriptions(
  merchantAccountId?: string,
): Promise<KBSubscription[]> {
  try {
    if (merchantAccountId) {
      return kbRequest<KBSubscription[]>(
        'GET',
        `/1.0/kb/accounts/${merchantAccountId}/bundles?includedDeleted=false`,
      ).then((bundles: unknown) =>
        // bundles → subscriptions (KB wraps in bundles)
        (bundles as Array<{ subscriptions: KBSubscription[] }>)
          .flatMap((b) => b.subscriptions),
      );
    }
    // Paginated search — first page, 100 records
    return kbRequest<KBSubscription[]>('GET', '/1.0/kb/subscriptions?offset=0&limit=100');
  } catch {
    return [];
  }
}

export async function retrieveSubscription(subscriptionId: string): Promise<KBSubscription> {
  return kbRequest<KBSubscription>('GET', `/1.0/kb/subscriptions/${subscriptionId}`);
}

// ── Accounts (customers in KB terms) ─────────────────────────────────────────

export interface KBAccount {
  accountId:  string;
  externalKey: string;
  email:      string | null;
  name:       string | null;
  currency:   string;
}

export async function listAccounts(): Promise<KBAccount[]> {
  try {
    return kbRequest<KBAccount[]>('GET', '/1.0/kb/accounts/search/?offset=0&limit=100');
  } catch {
    return [];
  }
}
