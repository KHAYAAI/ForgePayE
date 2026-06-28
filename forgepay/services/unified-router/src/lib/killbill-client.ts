import fetch from 'node-fetch';

const KILLBILL_URL = process.env['KILLBILL_URL'] || 'http://localhost:8080';
const KILLBILL_API_KEY = process.env['KILLBILL_API_KEY'];
const KILLBILL_API_SECRET = process.env['KILLBILL_API_SECRET'];

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

export async function createAccount(email: string, name: string): Promise<{ accountId: string }> {
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
      currency: 'ZAR',
      externalKey: email,
    }),
  } as any);

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Kill Bill create account failed: ${response.status} ${err}`);
  }

  return (await response.json()) as { accountId: string };
}
