/**
 * Server-side Kill Bill client for Next.js API routes.
 *
 * Credentials are read from environment variables — never exposed to the browser.
 * This module is ONLY imported from src/app/api/ route handlers (Node.js runtime).
 *
 * Auth: HTTP Basic using KILLBILL_API_KEY:KILLBILL_API_SECRET, base64-encoded.
 *       Kill Bill also requires X-Killbill-ApiKey / X-Killbill-ApiSecret headers
 *       for multi-tenant routing. All three credential layers are set on every call.
 *
 * NOTE: Kill Bill organises subscriptions inside "Bundles" — one Bundle per
 * subscription product (a customer buying two plans = two Bundles, each with
 * a subscription object inside). listSubscriptions() flattens the bundle array
 * for the dashboard view.
 *
 * NOTE: `next: { revalidate: 0 }` disables Next.js fetch caching on every call.
 * Billing data must never be served from a stale CDN cache.
 *
 * NOTE: Errors are thrown with a descriptive message. The API route handlers
 * catch these and return HTTP 502 to the browser.
 */

const KB_BASE =
  process.env['KILLBILL_BASE_URL'] ?? 'http://billing-engine:8020';

const API_KEY    = process.env['KILLBILL_API_KEY']    ?? 'forgepay';
const API_SECRET = process.env['KILLBILL_API_SECRET'] ?? 'forgepay';

const BASIC_AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64');

// ── Raw Kill Bill types ────────────────────────────────────────────────────────

/** A single subscription object inside a KB Bundle. */
export interface KBSubscription {
  subscriptionId:     string;
  accountId:          string;
  bundleId:           string;
  planName:           string;
  productName:        string;
  productCategory:    string;   // 'BASE' | 'ADD_ON' | 'STANDALONE'
  billingPeriod:      string;
  state:              string;   // 'ACTIVE' | 'CANCELLED' | 'PAUSED' | ...
  startDate:          string;   // ISO date (no time component)
  chargedThroughDate: string | null;
  cancelledDate:      string | null;
  priceList:          string;
  events:             KBSubscriptionEvent[];
}

export interface KBSubscriptionEvent {
  subscriptionEventType: string;
  effectiveDate:         string;
  planName:              string | null;
  phaseName:             string | null;
}

/** A Bundle groups a base subscription + optional add-ons under one accountId. */
export interface KBBundle {
  bundleId:      string;
  accountId:     string;
  externalKey:   string;
  subscriptions: KBSubscription[];
}

export interface KBInvoice {
  invoiceId:     string;
  accountId:     string;
  invoiceDate:   string;
  targetDate:    string;
  invoiceNumber: string;
  balance:       number;
  amount:        number;
  currency:      string;
  status:        string;
  items:         KBInvoiceItem[];
}

export interface KBInvoiceItem {
  invoiceItemId: string;
  type:          string;
  description:   string;
  planName:      string | null;
  phaseName:     string | null;
  startDate:     string;
  endDate:       string | null;
  amount:        number;
  currency:      string;
}

// ── Normalised shape consumed by the UI ───────────────────────────────────────

export interface NormalizedSubscription {
  id:              string;
  planName:        string;
  status:          string;
  startDate:       string;
  nextBillingDate: string;
  amount:          number;
  currency:        string;
}

// ── HTTP helper ───────────────────────────────────────────────────────────────

async function kbRequest<T>(
  method:  string,
  path:    string,
  body?:   unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'Authorization':          `Basic ${BASIC_AUTH}`,
    'Content-Type':           'application/json',
    'Accept':                 'application/json',
    'X-Killbill-ApiKey':      API_KEY,
    'X-Killbill-ApiSecret':   API_SECRET,
    'X-Killbill-CreatedBy':   'dashboard',
    'User-Agent':             'ForgePay-Dashboard/0.1.0',
  };

  const res = await fetch(`${KB_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    next: { revalidate: 0 },  // Never cache billing data
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new Error(err.message ?? `Kill Bill error ${res.status} on ${method} ${path}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Public API functions ───────────────────────────────────────────────────────

/**
 * List all subscription bundles for a merchant's Kill Bill account.
 * GET /1.0/kb/accounts/{merchantId}/bundles
 * Returns a normalised array suitable for the subscriptions UI.
 */
export async function listSubscriptions(
  merchantId: string,
): Promise<NormalizedSubscription[]> {
  const bundles = await kbRequest<KBBundle[]>(
    'GET',
    `/1.0/kb/accounts/${encodeURIComponent(merchantId)}/bundles`,
  );

  const result: NormalizedSubscription[] = [];

  for (const bundle of bundles) {
    for (const sub of bundle.subscriptions) {
      // Skip add-ons — only base subscriptions shown in the UI
      if (sub.productCategory === 'ADD_ON') continue;

      result.push({
        id:              sub.subscriptionId,
        planName:        sub.planName,
        status:          sub.state.toLowerCase(),
        startDate:       sub.startDate,
        nextBillingDate: sub.chargedThroughDate ?? sub.startDate,
        amount:          derivePlanAmount(sub.planName),
        currency:        'USD',
      });
    }
  }

  return result;
}

/**
 * Retrieve a single subscription by its Kill Bill subscription ID.
 * GET /1.0/kb/subscriptions/{subId}
 */
export async function getSubscription(subId: string): Promise<KBSubscription> {
  return kbRequest<KBSubscription>(
    'GET',
    `/1.0/kb/subscriptions/${encodeURIComponent(subId)}`,
  );
}

/**
 * Pause (suspend) a subscription at end of the current billing period.
 * PUT /1.0/kb/subscriptions/{subId}/pause
 */
export async function suspendSubscription(subId: string): Promise<void> {
  return kbRequest<void>(
    'PUT',
    `/1.0/kb/subscriptions/${encodeURIComponent(subId)}/pause`,
    { pausePolicy: 'END_OF_TERM' },
  );
}

/**
 * Resume a paused subscription.
 * PUT /1.0/kb/subscriptions/{subId}/undo_pause
 */
export async function resumeSubscription(subId: string): Promise<void> {
  return kbRequest<void>(
    'PUT',
    `/1.0/kb/subscriptions/${encodeURIComponent(subId)}/undo_pause`,
  );
}

/**
 * Cancel a subscription at end of the current billing period.
 * DELETE /1.0/kb/subscriptions/{subId}?policy=END_OF_TERM
 */
export async function cancelSubscription(subId: string): Promise<void> {
  return kbRequest<void>(
    'DELETE',
    `/1.0/kb/subscriptions/${encodeURIComponent(subId)}?policy=END_OF_TERM`,
  );
}

/**
 * Fetch the upcoming invoice for a Kill Bill account.
 * GET /1.0/kb/invoices/upcoming?accountId={accountId}
 */
export async function getUpcomingInvoice(accountId: string): Promise<KBInvoice> {
  return kbRequest<KBInvoice>(
    'GET',
    `/1.0/kb/invoices/upcoming?accountId=${encodeURIComponent(accountId)}`,
  );
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Best-effort price lookup from plan name (avoids an extra catalog API call). */
function derivePlanAmount(planName: string): number {
  if (planName.includes('growth-annual'))  return 5000;  // $50.00 in cents
  if (planName.includes('growth-monthly')) return 500;   // $5.00  in cents
  return 0;
}
