/**
 * Server-side Hyperswitch client for Next.js API routes.
 *
 * API key is read from environment — never exposed to the browser.
 * Each request extracts the merchant's API key from their session.
 */

const HS_BASE = process.env['HYPERSWITCH_BASE_URL'] ?? 'http://payment-engine:8080';

interface HSRequestOptions {
  apiKey:          string;
  idempotencyKey?: string;
}

async function hsRequest<T>(
  method:  string,
  path:    string,
  opts:    HSRequestOptions,
  body?:   unknown,
): Promise<T> {
  const headers: Record<string, string> = {
    'api-key':      opts.apiKey,
    'Content-Type': 'application/json',
    'User-Agent':   'ForgePay-Dashboard/0.1.0',
  };
  if (opts.idempotencyKey) headers['x-idempotency-key'] = opts.idempotencyKey;

  const res = await fetch(`${HS_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    next: { revalidate: 0 },   // Never cache payment data
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message ?? `Hyperswitch error ${res.status}`);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Payments ──────────────────────────────────────────────────────────────────

export async function listPayments(apiKey: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  return hsRequest<unknown>('GET', `/payments?${qs}`, { apiKey });
}

export async function retrievePayment(apiKey: string, paymentId: string) {
  return hsRequest<unknown>('GET', `/payments/${paymentId}`, { apiKey });
}

export async function refundPayment(
  apiKey:    string,
  paymentId: string,
  amount?:   number,
) {
  return hsRequest<unknown>('POST', '/refunds', { apiKey }, {
    payment_id: paymentId,
    ...(amount !== undefined ? { amount } : {}),
  });
}

// ── Customers ─────────────────────────────────────────────────────────────────

export async function listCustomers(apiKey: string) {
  return hsRequest<unknown>('GET', '/customers', { apiKey });
}

export async function retrieveCustomer(apiKey: string, customerId: string) {
  return hsRequest<unknown>('GET', `/customers/${customerId}`, { apiKey });
}

// ── Analytics (via Hyperswitch analytics endpoint) ────────────────────────────

export interface PaymentsSummary {
  total_count:       number;
  success_count:     number;
  failure_count:     number;
  total_amount:      number;
  success_rate:      number;
}

export async function getPaymentsSummary(apiKey: string, days = 30): Promise<PaymentsSummary> {
  const end   = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);

  try {
    return await hsRequest<PaymentsSummary>('GET', `/analytics/payments/summary?start=${start.toISOString()}&end=${end.toISOString()}`, { apiKey });
  } catch {
    // Analytics endpoint may not be available in all Hyperswitch versions
    return { total_count: 0, success_count: 0, failure_count: 0, total_amount: 0, success_rate: 0 };
  }
}
