/**
 * ForgePay Checkout Load Test
 *
 * Stress test for shielded checkout endpoint
 * Usage: k6 run --vus 100 --duration 5m checkout-load-test.js
 *
 * Thresholds:
 * - HTTP success rate: > 99%
 * - P95 latency: < 500ms
 * - Decryption success rate: > 99%
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics
const decryptionErrorRate = new Rate('decryption_errors');
const checkoutLatency = new Trend('checkout_latency');
const checkoutSuccessRate = new Rate('checkout_success');
const activeVUs = new Gauge('active_vus');
const totalTransactionValue = new Counter('total_transaction_value');

// Test configuration
const config = {
  baseUrl: __ENV.FORGEPAY_API_URL || 'https://checkout.staging.forgepay.io',
  apiKey: __ENV.FORGEPAY_API_KEY || 'test_key_load_test',
  merchants: ['merch_demo_001', 'merch_demo_002', 'merch_demo_003'],
  amounts: [4999, 9999, 49990, 99990],  // $49.99, $99.99, $499.90, $999.90
  countries: ['US', 'GB', 'DE', 'FR', 'JP'],
};

export const options = {
  stages: [
    { duration: '1m', target: 10 },    // Ramp-up: 0 → 10 VUs
    { duration: '2m', target: 50 },    // Ramp-up: 10 → 50 VUs
    { duration: '5m', target: 100 },   // Stress: 50 → 100 VUs
    { duration: '5m', target: 100 },   // Hold: 100 VUs
    { duration: '2m', target: 50 },    // Ramp-down: 100 → 50 VUs
    { duration: '1m', target: 0 },     // Ramp-down: 50 → 0 VUs
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500'],  // P95 latency < 500ms
    'http_req_failed': ['rate<0.01'],    // Error rate < 1%
    'checkout_latency': ['p(95)<500'],   // P95 checkout latency < 500ms
    'checkout_success': ['rate>0.99'],   // Success rate > 99%
    'decryption_errors': ['rate<0.01'],  // Decryption error < 1%
  },
};

// Test data generator
function generateTestData() {
  const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const randomChoice = (arr) => arr[Math.floor(Math.random() * arr.length)];

  return {
    merchant_id: randomChoice(config.merchants),
    customer_id: `cus_load_test_${randomInt(1, 10000)}`,
    customer_email: `test${randomInt(1, 100000)}@loadtest.forgepay.io`,
    amount: randomChoice(config.amounts),
    currency: 'USD',
    customer_country: randomChoice(config.countries),
    customer_state: randomChoice(['CA', 'NY', 'TX']),
    payment_methods: ['card', 'usdc'],
    success_url: 'https://example.com/success',
    cancel_url: 'https://example.com/cancel',
    metadata: {
      order_id: `order_${randomInt(1, 1000000)}`,
      product: 'Load Test Product',
    },
  };
}

// Generate mock encrypted memo and proof
function generateMockProof() {
  return {
    encrypted_memo: btoa(JSON.stringify({
      ephemeral_pk: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
      nonce: Array(24).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
      ciphertext: btoa(Math.random().toString()),
      auth_tag: Array(32).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join(''),
    })),
    audit_proof: 'STUB_PROOF_' + Math.random().toString(36).substring(7),
  };
}

export default function () {
  const testData = generateTestData();
  const proof = generateMockProof();

  activeVUs.add(1);

  group('Shielded Checkout Flow', function () {
    // Regular checkout (baseline)
    group('Regular Checkout (Baseline)', function () {
      const regularPayload = JSON.stringify(testData);
      const regularRes = http.post(
        `${config.baseUrl}/v1/checkout/sessions`,
        regularPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
        }
      );

      check(regularRes, {
        'regular checkout status 200': (r) => r.status === 200,
        'regular checkout has session_id': (r) => r.json('session_id') !== undefined,
        'regular checkout has client_secret': (r) => r.json('client_secret') !== undefined,
      });

      checkoutSuccessRate.add(regularRes.status === 200);
      checkoutLatency.add(regularRes.timings.duration);
      totalTransactionValue.add(testData.amount);
    });

    // Shielded checkout (privacy feature)
    group('Shielded Checkout (Privacy)', function () {
      const shieldedPayload = JSON.stringify({
        ...testData,
        encrypted_memo: proof.encrypted_memo,
        audit_proof: proof.audit_proof,
      });

      const shieldedRes = http.post(
        `${config.baseUrl}/v1/checkout/sessions/shielded`,
        shieldedPayload,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
        }
      );

      check(shieldedRes, {
        'shielded checkout status 200': (r) => r.status === 200,
        'shielded checkout has session_id': (r) => r.json('session_id') !== undefined,
        'shielded checkout has nullifier': (r) => r.json('nullifier') !== undefined || r.status !== 200,
        'shielded checkout response time < 1s': (r) => r.timings.duration < 1000,
      });

      const isSuccess = shieldedRes.status === 200;
      checkoutSuccessRate.add(isSuccess);
      checkoutLatency.add(shieldedRes.timings.duration);

      if (!isSuccess) {
        decryptionErrorRate.add(1);
        console.log(`Decryption error: ${shieldedRes.status} - ${shieldedRes.body}`);
      } else {
        decryptionErrorRate.add(0);
        totalTransactionValue.add(testData.amount);
      }
    });

    // Retrieve checkout session (read path)
    group('Retrieve Session', function () {
      const listRes = http.get(
        `${config.baseUrl}/v1/checkout/sessions`,
        {
          headers: {
            'Authorization': `Bearer ${config.apiKey}`,
          },
        }
      );

      check(listRes, {
        'list sessions status 200': (r) => r.status === 200,
        'list sessions has data': (r) => r.json('data') !== undefined,
      });
    });
  });

  // Vary think time between requests (realistic user behavior)
  sleep(__VU % 3 === 0 ? 0 : __VU % 3 === 1 ? 0.5 : 1);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'summary.json': JSON.stringify(data),
  };
}

export function teardown(data) {
  console.log('Load test complete. Summary saved to summary.json');
}
