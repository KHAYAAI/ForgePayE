import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Stress test for ForgePay checkout API
 * Ramps up to 500 concurrent users and sustains for 5 minutes
 *
 * Usage:
 *   k6 run --out json=results/stress.json checkout-stress-test.js
 *   BASE_URL=https://api.staging.forgepay.io k6 run checkout-stress-test.js
 *
 * Thresholds (relaxed vs standard 100 VU):
 * - p95 latency: < 800 ms (vs 500ms for standard)
 * - Error rate: < 0.5% (vs 0.1% for standard)
 */
export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp-up: 0 → 100 VUs
    { duration: '3m', target: 300 },   // Ramp-up: 100 → 300 VUs
    { duration: '5m', target: 500 },   // Ramp-up: 300 → 500 VUs
    { duration: '5m', target: 500 },   // Hold: 500 VUs (stress)
    { duration: '2m', target: 0 },     // Ramp-down: 500 → 0 VUs
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<1500'],  // Relaxed for stress
    http_req_failed: ['rate<0.005'],                   // < 0.5% errors
    'checkout_latency': ['p(95)<800'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8010';

export default function () {
  // Create checkout session (regular non-shielded)
  const payload = JSON.stringify({
    merchant_id: 'mer_stress_test',
    currency: 'USD',
    amount_subtotal_cents: 1999,
    customer_id: `cus_${__VU}_${__ITER}`,
    customer_email: `stress${__VU}@loadtest.forgepay.io`,
    customer_country: 'US',
    customer_state: 'CA',
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/cancel',
    metadata: {
      test_name: 'stress',
      vu: String(__VU),
      iteration: String(__ITER),
    },
  });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer sk_test_${__ENV.API_KEY || 'dev'}`,
  };

  const startTime = new Date().getTime();
  const res = http.post(`${BASE_URL}/v1/checkout/sessions`, payload, { headers });
  const latency = new Date().getTime() - startTime;

  check(res, {
    'checkout status 201': (r) => r.status === 201,
    'checkout response has session_id': (r) => r.json().session_id !== undefined,
    'checkout response has payment_id': (r) => r.json().payment_id !== undefined,
    'checkout response time': (r) => latency < 800,
  });

  // Record custom metric
  if (__VU % 100 === 0) {
    console.log(`[VU ${__VU}] Checkout latency: ${latency}ms`);
  }

  sleep(__VU % 3 === 0 ? 0.5 : __VU % 3 === 1 ? 1 : 1.5);
}
