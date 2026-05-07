/**
 * Minimal Kill Bill API client used by the killbill normalizer to enrich
 * webhook notification payloads with data that Kill Bill doesn't include
 * in the notification body (planId, currentPeriodEnd, invoice amount).
 */

import { config } from '../config.js';

interface KBSubscription {
  subscriptionId:    string;
  planName:          string;
  state:             string;
  billingPeriod:     string;
  chargedThroughDate?: string;
}

interface KBInvoice {
  invoiceId:       string;
  amount:          number;
  currency:        string;
  status:          string;
  invoiceDate:     string;
}

const REQUEST_TIMEOUT_MS = 5_000;

function authHeaders(tenantApiKey: string): Record<string, string> {
  const b64 = Buffer.from(`${config.killbill.apiKey}:${config.killbill.apiSecret}`).toString('base64');
  return {
    'Authorization':       `Basic ${b64}`,
    'X-Killbill-ApiKey':   tenantApiKey,
    'X-Killbill-ApiSecret': config.killbill.apiSecret,
    'Accept':              'application/json',
  };
}

async function kbFetch<T>(path: string, tenantApiKey: string): Promise<T | null> {
  try {
    const res = await fetch(`${config.killbill.baseUrl}${path}`, {
      headers: authHeaders(tenantApiKey),
      signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return res.json() as Promise<T>;
  } catch {
    return null;
  }
}

export async function fetchSubscription(
  subscriptionId: string,
  tenantApiKey: string,
): Promise<KBSubscription | null> {
  return kbFetch<KBSubscription>(
    `/1.0/kb/subscriptions/${subscriptionId}`,
    tenantApiKey,
  );
}

export async function fetchInvoice(
  invoiceId: string,
  tenantApiKey: string,
): Promise<KBInvoice | null> {
  return kbFetch<KBInvoice>(
    `/1.0/kb/invoices/${invoiceId}`,
    tenantApiKey,
  );
}
