/**
 * Server-side Hyperswitch client for Next.js API routes.
 *
 * API key is read from the merchant session server-side — never exposed to the browser.
 * This module is ONLY imported from src/app/api/ route handlers (Node.js runtime).
 *
 * NOTE: `next: { revalidate: 0 }` disables Next.js fetch caching on every call.
 * Payment data must NEVER be cached at the CDN or server layer — a refunded
 * payment must show "refunded" immediately, not serve a cached "succeeded" response.
 * If you switch to React Server Components for any payment data, keep this option.
 *
 * NOTE: Errors are surfaced as thrown Errors with the Hyperswitch error message.
 * The API route handlers catch these and return HTTP 502 to the browser, so the
 * UI can display "Payment engine unavailable" without leaking internal details.
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

// ── Admin-level requests (use platform admin API key, not a merchant key) ────────

/** Use the platform-level admin API key for operations that create merchant accounts. */
async function adminHsRequest<T>(
  path: string,
  opts: { method: string; body?: unknown },
): Promise<T> {
  const adminKey = process.env['HYPERSWITCH_API_KEY'] ?? '';
  return hsRequest<T>(opts.method, path, { apiKey: adminKey }, opts.body);
}

// ── Merchant account management ───────────────────────────────────────────────

export async function createMerchant(params: {
  merchantName: string;
  email: string;
}): Promise<{ merchantId: string; apiKey: string; publishableKey: string }> {
  const data = await adminHsRequest<{
    merchant_id: string;
    api_key: string;
    publishable_key: string;
  }>('/merchant_accounts', {
    method: 'POST',
    body: {
      merchant_name: params.merchantName,
      merchant_details: {
        primary_email: params.email,
        primary_business_country: 'US',
        primary_business_label: 'default',
      },
      metadata: { source: 'forgepay-dashboard-signup' },
    },
  });
  return {
    merchantId:     data.merchant_id,
    apiKey:         data.api_key,
    publishableKey: data.publishable_key,
  };
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
