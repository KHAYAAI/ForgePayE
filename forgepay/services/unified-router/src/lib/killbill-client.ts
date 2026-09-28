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

const KILLBILL_URL = config.killbill.baseUrl;
const KILLBILL_API_KEY = config.killbill.apiKey;
const KILLBILL_API_SECRET = config.killbill.apiSecret;

function base64(str: string): string {
  return Buffer.from(str).toString('base64');
}

const auth = base64(`${KILLBILL_API_KEY}:${KILLBILL_API_SECRET}`);

export interface CreateSubscriptionRequest {
  accountId: string;
  planName: string;
  externalKey: string;
  requestedDate?: string;
}

export interface Subscription {
  subscriptionId: string;
  accountId: string;
  planName: string;
  productName: string;
  state: 'ACTIVE' | 'CANCELLED' | 'PAUSED' | 'PENDING';
  chargedThroughDate?: string;
  billingPeriodStartDate: string;
  billingPeriodEndDate: string;
  externalKey: string;
}

export interface Invoice {
  invoiceId: string;
  invoiceNumber: string;
  accountId: string;
  amount: number;
  dueDate: string;
  status: 'DRAFT' | 'COMMITTED' | 'VOID';
  items: Array<{
    description: string;
    amount: number;
    lineItemType: string;
  }>;
}

export async function createSubscription(req: CreateSubscriptionRequest): Promise<Subscription> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/subscriptions`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'X-Killbill-CreatedBy': 'forgepay-api',
      'X-Killbill-Reason': 'new_subscription',
    },
    body: JSON.stringify({
      accountId: req.accountId,
      planName: req.planName,
      externalKey: req.externalKey,
      requestedDate: req.requestedDate || new Date().toISOString().split('T')[0],
      autoRenew: true,
    }),
  } as any);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Kill Bill create subscription failed: ${response.status} ${err}`);
  }

  return (await response.json()) as Subscription;
}

export async function changeSubscriptionPlan(
  subscriptionId: string,
  newPlanName: string,
  requestedDate?: string
): Promise<Subscription> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/subscriptions/${subscriptionId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'X-Killbill-CreatedBy': 'forgepay-api',
      'X-Killbill-Reason': 'plan_upgrade',
    },
    body: JSON.stringify({
      planName: newPlanName,
      requestedDate: requestedDate || new Date().toISOString().split('T')[0],
      billingPolicy: 'IMMEDIATE',
    }),
  } as any);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Kill Bill change plan failed: ${response.status} ${err}`);
  }

  return (await response.json()) as Subscription;
}

export async function cancelSubscription(
  subscriptionId: string,
  requestedDate?: string
): Promise<void> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'X-Killbill-CreatedBy': 'forgepay-api',
      'X-Killbill-Reason': 'customer_cancellation',
    },
    body: JSON.stringify({
      requestedDate: requestedDate || new Date().toISOString().split('T')[0],
    }),
  } as any);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Kill Bill cancel failed: ${response.status} ${err}`);
  }
}

export async function getSubscription(subscriptionId: string): Promise<Subscription> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/subscriptions/${subscriptionId}`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  } as any);

  if (!response.ok) {
    throw new Error(`Kill Bill subscription not found: ${response.status}`);
  }

  return (await response.json()) as Subscription;
}

export async function listSubscriptions(accountId: string): Promise<Subscription[]> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/accounts/${accountId}/subscriptions`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  } as any);

  if (!response.ok) {
    return [];
  }

  return (await response.json()) as Subscription[];
}

export async function getInvoices(accountId: string): Promise<Invoice[]> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/accounts/${accountId}/invoices`, {
    headers: {
      Authorization: `Basic ${auth}`,
    },
  } as any);

  if (!response.ok) {
    return [];
  }

  return (await response.json()) as Invoice[];
}

export async function createAccount(
  email: string,
  name: string,
  currency = 'USD', // was hardcoded 'ZAR' — wrong for pricing.yaml's USD-denominated tiers
): Promise<{ accountId: string }> {
  const response = await fetch(`${KILLBILL_URL}/1.0/kb/accounts`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'X-Killbill-CreatedBy': 'forgepay-api',
    },
    body: JSON.stringify({
      name,
      email,
      currency,
      externalKey: email,
    }),
  } as any);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Kill Bill create account failed: ${response.status} ${err}`);
  }

  return (await response.json()) as { accountId: string };
}
