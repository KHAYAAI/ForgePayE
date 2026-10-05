// Node 20 (the Docker runtime for this service) ships a native, global
// `fetch` — no need for the node-fetch package (whose v3 is ESM-only and
// cannot be `require()`'d from this CommonJS-compiled service anyway).

// Was reading its own process.env['KILLBILL_URL']/['KILLBILL_API_KEY'] directly,
// independent of config.ts's config.killbill — two different env var names
// (KILLBILL_URL here vs. KILLBILL_BASE_URL in config.ts) with two different
// default ports (8080 here, 8020 in config.ts) for the same billing-engine.
// Whichever one nobody happened to set, this client silently pointed at the
// wrong default. Now reads the one shared config the rest of the service uses.
import { config } from '../config.js';

/**
 * Kill Bill authenticates twice on every request: HTTP Basic for a Kill Bill
 * *user* (KILLBILL_USERNAME / KILLBILL_PASSWORD), and the X-Killbill-ApiKey /
 * X-Killbill-ApiSecret headers for the *tenant*. This client used to send the
 * tenant key and secret as the Basic credentials and no tenant headers, so
 * every call was a 401.
 *
 * Create calls answer 201 with an empty body and a Location header; the new
 * object is read back from there. Checked against Kill Bill 0.24.10.
 */
function headers(extra: Record<string, string> = {}): Record<string, string> {
  const basic = Buffer.from(`${config.killbill.username}:${config.killbill.password}`).toString('base64');
  return {
    Authorization:          `Basic ${basic}`,
    'X-Killbill-ApiKey':    config.killbill.apiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'X-Killbill-CreatedBy': 'forgepay-api',
    Accept:                 'application/json',
    ...extra,
  };
}

function url(path: string): string {
  return `${config.killbill.baseUrl.replace(/\/$/, '')}/1.0/kb${path}`;
}

async function call(method: string, path: string, opts: { body?: unknown; reason?: string } = {}): Promise<Response> {
  return fetch(url(path), {
    method,
    headers: headers({
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.reason ? { 'X-Killbill-Reason': opts.reason } : {}),
    }),
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

async function fail(what: string, res: Response): Promise<never> {
  const err = await res.text().catch(() => '');
  throw new Error(`Kill Bill ${what} failed: ${res.status} ${err}`);
}

/** The id at the end of a 201's Location header. */
function createdId(res: Response, what: string): string {
  const loc = res.headers.get('location') ?? '';
  const id = loc.split('?')[0]!.split('/').filter(Boolean).pop();
  if (!id) throw new Error(`Kill Bill ${what}: no Location header on ${res.status}`);
  return id;
}

export interface CreateSubscriptionRequest {
  accountId: string;
  planName: string;
  externalKey: string;
  requestedDate?: string;
}

/** The fields this service reads from Kill Bill's Subscription JSON. */
export interface Subscription {
  subscriptionId: string;
  accountId: string;
  bundleId: string;
  planName: string;
  productName: string;
  phaseType: string;
  state: 'PENDING' | 'ACTIVE' | 'BLOCKED' | 'CANCELLED' | 'EXPIRED';
  chargedThroughDate?: string | null;
  billingStartDate: string;
  billingEndDate?: string | null;
  externalKey: string;
}

export interface Invoice {
  invoiceId: string;
  invoiceNumber: string;
  accountId: string;
  amount: number;
  balance: number;
  invoiceDate: string;
  targetDate: string;
  status: 'DRAFT' | 'COMMITTED' | 'VOID';
  items?: Array<{
    description: string;
    amount: number;
    itemType: string;
  }>;
}

export async function createSubscription(req: CreateSubscriptionRequest): Promise<Subscription> {
  const res = await call('POST', '/subscriptions', {
    reason: 'new_subscription',
    body: {
      accountId:   req.accountId,
      planName:    req.planName,
      externalKey: req.externalKey,
      ...(req.requestedDate ? { billingStartDate: req.requestedDate } : {}),
    },
  });
  if (res.status !== 201) await fail('create subscription', res);
  return getSubscription(createdId(res, 'create subscription'));
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanName: string,
  requestedDate?: string
): Promise<Subscription> {
  const q = new URLSearchParams({ billingPolicy: 'IMMEDIATE', ...(requestedDate ? { requestedDate } : {}) });
  const res = await call('PUT', `/subscriptions/${encodeURIComponent(subscriptionId)}?${q}`, {
    reason: 'plan_change',
    body: { planName: newPlanName },
  });
  if (!res.ok) await fail('change plan', res);
  return getSubscription(subscriptionId);
}

export async function cancelSubscription(
  subscriptionId: string,
  requestedDate?: string
): Promise<void> {
  const q = requestedDate ? `?${new URLSearchParams({ requestedDate })}` : '';
  const res = await call('DELETE', `/subscriptions/${encodeURIComponent(subscriptionId)}${q}`, {
    reason: 'customer_cancellation',
  });
  if (!res.ok) await fail('cancel', res);
}

export async function getSubscription(subscriptionId: string): Promise<Subscription> {
  const res = await call('GET', `/subscriptions/${encodeURIComponent(subscriptionId)}`);
  if (!res.ok) await fail('get subscription', res);
  return (await res.json()) as Subscription;
}

/** Every subscription on an account, across its bundles. */
export async function listSubscriptions(accountId: string): Promise<Subscription[]> {
  const res = await call('GET', `/accounts/${encodeURIComponent(accountId)}/bundles`);
  if (!res.ok) return [];
  const bundles = (await res.json()) as Array<{ subscriptions: Subscription[] }>;
  return bundles.flatMap((b) => b.subscriptions);
}

export async function getInvoices(accountId: string): Promise<Invoice[]> {
  const res = await call('GET', `/accounts/${encodeURIComponent(accountId)}/invoices?withItems=true`);
  if (!res.ok) return [];
  return (await res.json()) as Invoice[];
}

export async function createAccount(
  email: string,
  name: string,
  currency = 'USD', // was hardcoded 'ZAR' — wrong for pricing.yaml's USD-denominated tiers
): Promise<{ accountId: string }> {
  const res = await call('POST', '/accounts', {
    body: { name, email, currency, externalKey: email },
  });
  if (res.status !== 201) await fail('create account', res);
  return { accountId: createdId(res, 'create account') };
}

/**
 * Register the card a customer saved at checkout as the account's default
 * payment method, so Kill Bill can charge renewals. The card stays in
 * Hyperswitch's vault; Kill Bill only holds the reference, in the format the
 * forgepay-hyperswitch plugin reads (billing-engine/forgepay-plugin).
 */
export async function addHyperswitchPaymentMethod(
  accountId: string,
  hyperswitchCustomerId: string,
  hyperswitchPaymentMethodId: string,
): Promise<{ paymentMethodId: string }> {
  const res = await call('POST', `/accounts/${encodeURIComponent(accountId)}/paymentMethods?isDefault=true`, {
    reason: 'card_saved_at_checkout',
    body: {
      pluginName:  'forgepay-hyperswitch',
      externalKey: `hyperswitch:${hyperswitchCustomerId}:${hyperswitchPaymentMethodId}`,
      isDefault:   true,
    },
  });
  if (res.status !== 201) await fail('add payment method', res);
  return { paymentMethodId: createdId(res, 'add payment method') };
}
