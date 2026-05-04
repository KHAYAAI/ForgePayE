import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * Spike test for ForgePay checkout API
 * Rapidly scales from 0 to 1000 concurrent users in 30 seconds
 * Tests how well the system handles sudden traffic spikes and rate limiting
 *
 * Usage:
 *   k6 run --out json=results/spike.json checkout-spike-test.js
 *
 * Thresholds intentionally lenient:
 * - p99 latency: < 2000 ms (spike may cause queuing)
 * - Error rate: < 5% (rate limiting and queuing expected)
 *
 * This test validates that the system degrades gracefully under extreme load,
 * not that it maintains performance.
 */
export const options = {
  stages: [
    { duration: '30s', target: 1000 },   // Spike: 0 → 1000 VUs in 30s
    { duration: '2m', target: 1000 },    // Hold: 1000 VUs for 2 min
    { duration: '1m', target: 0 },       // Ramp-down: 1000 → 0 VUs
  ],
  thresholds: {
    http_req_duration: ['p(99)<2000'],   // Very lenient for spike test
    http_req_failed: ['rate<0.05'],      // < 5% errors acceptable
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8010';

export default function () {
  const payload = JSON.stringify({
    merchant_id: 'mer_spike_test',
    currency: 'USD',
    amount_subtotal_cents: 1999,
    customer_id: `cus_spike_${__VU}_${__ITER}`,
    customer_email: `spike${__VU}@loadtest.forgepay.io`,
    customer_country: 'US',
    customer_state: 'NY',
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/cancel',
    metadata: {
      test_name: 'spike',
      vu: String(__VU),
      iteration: String(__ITER),
    },
  });

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer sk_test_${__ENV.API_KEY || 'dev'}`,
  };

  const res = http.post(`${BASE_URL}/v1/checkout/sessions`, payload, { headers });

  check(res, {
    'response status 201 or 429': (r) => r.status === 201 || r.status === 429,
    'checkout session created (if 201)': (r) => r.status !== 201 || r.json().session_id !== undefined,
  });

  sleep(0.1);
}
