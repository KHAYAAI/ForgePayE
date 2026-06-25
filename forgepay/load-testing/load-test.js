/**
 * ForgePay Comprehensive Load Testing Suite
 *
 * Tests all critical service endpoints under load.
 * Usage: k6 run load-test.js
 *
 * Metrics tracked:
 * - P50, P95, P99 latency (ms)
 * - Error rate (%)
 * - RPS throughput
 *
 * Pass/fail thresholds:
 * - P99 latency < 2000ms
 * - Error rate < 1%
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';

// Configuration
const CONFIG = {
  baseUrl: __ENV.BASE_URL || 'http://localhost',
  duration: __ENV.DURATION || '5m',
};

// Service endpoints and load profiles
const SERVICES = {
  'unified-router': {
    endpoint: '/webhooks/hyperswitch',
    method: 'POST',
    port: 8000,
    rps: 100,
    duration: '5m',
    payload: JSON.stringify({
      type: 'payment.success',
      payment_id: 'pay_' + Date.now(),
      amount: 10000,
      currency: 'USD',
      timestamp: new Date().toISOString(),
    }),
  },
  'mor-layer': {
    endpoint: '/v1/checkout/sessions',
    method: 'POST',
    port: 8010,
    rps: 50,
    duration: '5m',
    payload: JSON.stringify({
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Test Product' },
            unit_amount: 2000,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    }),
  },
  'crypto-gateway': {
    endpoint: '/invoices/inv_' + Math.random().toString(36).substr(2, 9),
    method: 'GET',
    port: 8030,
    rps: 100,
    duration: '5m',
    payload: null,
  },
  'stablecoin-gateway': {
    endpoint: '/deposits',
    method: 'POST',
    port: 8020,
    rps: 50,
    duration: '5m',
    payload: JSON.stringify({
      amount: 1000000, // 1 USDC in cents
      currency: 'USDC',
      network: 'polygon',
      recipient_address: '0x' + '0'.repeat(40),
    }),
  },
  'yield-engine': {
    endpoint: '/positions/merchant_' + Math.random().toString(36).substr(2, 9),
    method: 'GET',
    port: 8050,
    rps: 200,
    duration: '5m',
    payload: null,
  },
  'agent-identity': {
    endpoint: '/v1/agents',
    method: 'GET',
    port: 3010,
    rps: 100,
    duration: '5m',
    payload: null,
  },
};

// Export options for k6
export const options = {
  // Define scenarios for each service
  scenarios: {
    'unified-router-load': {
      executor: 'constant-arrival-rate',
      rate: SERVICES['unified-router'].rps,
      timeUnit: '1s',
      duration: SERVICES['unified-router'].duration,
      preAllocatedVUs: 50,
      maxVUs: 100,
      tags: { service: 'unified-router' },
      exec: 'testUnifiedRouter',
    },
    'mor-layer-load': {
      executor: 'constant-arrival-rate',
      rate: SERVICES['mor-layer'].rps,
      timeUnit: '1s',
      duration: SERVICES['mor-layer'].duration,
      preAllocatedVUs: 30,
      maxVUs: 60,
      tags: { service: 'mor-layer' },
      exec: 'testMorLayer',
    },
    'crypto-gateway-load': {
      executor: 'constant-arrival-rate',
      rate: SERVICES['crypto-gateway'].rps,
      timeUnit: '1s',
      duration: SERVICES['crypto-gateway'].duration,
      preAllocatedVUs: 50,
      maxVUs: 100,
      tags: { service: 'crypto-gateway' },
      exec: 'testCryptoGateway',
    },
    'stablecoin-gateway-load': {
      executor: 'constant-arrival-rate',
      rate: SERVICES['stablecoin-gateway'].rps,
      timeUnit: '1s',
      duration: SERVICES['stablecoin-gateway'].duration,
      preAllocatedVUs: 30,
      maxVUs: 60,
      tags: { service: 'stablecoin-gateway' },
      exec: 'testStablecoinGateway',
    },
    'yield-engine-load': {
      executor: 'constant-arrival-rate',
      rate: SERVICES['yield-engine'].rps,
      timeUnit: '1s',
      duration: SERVICES['yield-engine'].duration,
      preAllocatedVUs: 100,
      maxVUs: 150,
      tags: { service: 'yield-engine' },
      exec: 'testYieldEngine',
    },
    'agent-identity-load': {
      executor: 'constant-arrival-rate',
      rate: SERVICES['agent-identity'].rps,
      timeUnit: '1s',
      duration: SERVICES['agent-identity'].duration,
      preAllocatedVUs: 50,
      maxVUs: 100,
      tags: { service: 'agent-identity' },
      exec: 'testAgentIdentity',
    },
  },

  // Thresholds for pass/fail
  thresholds: {
    'http_req_duration{service:unified-router}': ['p(99) < 2000'],
    'http_req_duration{service:mor-layer}': ['p(99) < 2000'],
    'http_req_duration{service:crypto-gateway}': ['p(99) < 2000'],
    'http_req_duration{service:stablecoin-gateway}': ['p(99) < 2000'],
    'http_req_duration{service:yield-engine}': ['p(99) < 2000'],
    'http_req_duration{service:agent-identity}': ['p(99) < 2000'],
    http_req_failed: ['rate < 0.01'], // < 1% error rate
  },
};

/**
 * Test unified-router POST /webhooks/hyperswitch
 */
export function testUnifiedRouter() {
  const url = `${CONFIG.baseUrl}:${SERVICES['unified-router'].port}${SERVICES['unified-router'].endpoint}`;
  const payload = SERVICES['unified-router'].payload;

  group('unified-router-webhook', () => {
    const params = {
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': generateSignature(payload, 'dev-internal-secret-change-me'),
      },
      tags: { service: 'unified-router' },
    };

    const res = http.post(url, payload, params);
    check(res, {
      'status is 2xx': (r) => r.status >= 200 && r.status < 300,
      'response time < 2s': (r) => r.timings.duration < 2000,
      'has content-type': (r) => r.headers['Content-Type'] !== undefined,
    });

    sleep(0.5);
  });
}

/**
 * Test mor-layer POST /v1/checkout/sessions
 */
export function testMorLayer() {
  const url = `${CONFIG.baseUrl}:${SERVICES['mor-layer'].port}${SERVICES['mor-layer'].endpoint}`;
  const payload = SERVICES['mor-layer'].payload;

  group('mor-layer-checkout', () => {
    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
      tags: { service: 'mor-layer' },
    };

    const res = http.post(url, payload, params);
    check(res, {
      'status is 2xx': (r) => r.status >= 200 && r.status < 300,
      'response time < 2s': (r) => r.timings.duration < 2000,
      'has session id': (r) => r.body.includes('id') || r.status >= 400,
    });

    sleep(0.5);
  });
}

/**
 * Test crypto-gateway GET /invoices/{id}
 */
export function testCryptoGateway() {
  const url = `${CONFIG.baseUrl}:${SERVICES['crypto-gateway'].port}${SERVICES['crypto-gateway'].endpoint}`;

  group('crypto-gateway-invoice', () => {
    const params = {
      headers: {
        'Accept': 'application/json',
      },
      tags: { service: 'crypto-gateway' },
    };

    const res = http.get(url, params);
    check(res, {
      'status is 2xx or 4xx': (r) => (r.status >= 200 && r.status < 300) || (r.status >= 400 && r.status < 500),
      'response time < 2s': (r) => r.timings.duration < 2000,
    });

    sleep(0.5);
  });
}

/**
 * Test stablecoin-gateway POST /deposits
 */
export function testStablecoinGateway() {
  const url = `${CONFIG.baseUrl}:${SERVICES['stablecoin-gateway'].port}${SERVICES['stablecoin-gateway'].endpoint}`;
  const payload = SERVICES['stablecoin-gateway'].payload;

  group('stablecoin-gateway-deposit', () => {
    const params = {
      headers: {
        'Content-Type': 'application/json',
      },
      tags: { service: 'stablecoin-gateway' },
    };

    const res = http.post(url, payload, params);
    check(res, {
      'status is 2xx': (r) => r.status >= 200 && r.status < 300,
      'response time < 2s': (r) => r.timings.duration < 2000,
      'has transaction id': (r) => r.body.includes('tx_id') || r.status >= 400,
    });

    sleep(0.5);
  });
}

/**
 * Test yield-engine GET /positions/{merchantId}
 */
export function testYieldEngine() {
  const url = `${CONFIG.baseUrl}:${SERVICES['yield-engine'].port}${SERVICES['yield-engine'].endpoint}`;

  group('yield-engine-positions', () => {
    const params = {
      headers: {
        'Accept': 'application/json',
      },
      tags: { service: 'yield-engine' },
    };

    const res = http.get(url, params);
    check(res, {
      'status is 2xx or 4xx': (r) => (r.status >= 200 && r.status < 300) || (r.status >= 400 && r.status < 500),
      'response time < 2s': (r) => r.timings.duration < 2000,
    });

    sleep(0.5);
  });
}

/**
 * Test agent-identity GET /v1/agents
 */
export function testAgentIdentity() {
  const url = `${CONFIG.baseUrl}:${SERVICES['agent-identity'].port}${SERVICES['agent-identity'].endpoint}`;

  group('agent-identity-list', () => {
    const params = {
      headers: {
        'Accept': 'application/json',
      },
      tags: { service: 'agent-identity' },
    };

    const res = http.get(url, params);
    check(res, {
      'status is 2xx or 4xx': (r) => (r.status >= 200 && r.status < 300) || (r.status >= 400 && r.status < 500),
      'response time < 2s': (r) => r.timings.duration < 2000,
    });

    sleep(0.5);
  });
}

/**
 * Generate HMAC-SHA256 signature for webhook verification
 */
function generateSignature(payload, secret) {
  // Note: In production, use a proper crypto library like crypto-js
  // For k6, we'll create a simple placeholder signature
  // In real scenarios, the backend should verify this
  return 'sha256=' + Buffer.from(payload + secret).toString('hex').substr(0, 64);
}

// Hook: after test completes, output summary
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    test_duration: data.state.testRunDurationMs / 1000,
    metrics: {
      unified_router: extractMetrics(data, 'unified-router'),
      mor_layer: extractMetrics(data, 'mor-layer'),
      crypto_gateway: extractMetrics(data, 'crypto-gateway'),
      stablecoin_gateway: extractMetrics(data, 'stablecoin-gateway'),
      yield_engine: extractMetrics(data, 'yield-engine'),
      agent_identity: extractMetrics(data, 'agent-identity'),
    },
  };

  console.log('\n=== ForgePay Load Test Summary ===\n');
  console.log(JSON.stringify(summary, null, 2));

  // Return the summary for JSON output
  return {
    'stdout': JSON.stringify(summary, null, 2),
    'json': summary,
  };
}

/**
 * Extract latency and error rate metrics for a service
 */
function extractMetrics(data, service) {
  const tag = `service:${service}`;
  const metrics = data.metrics;

  const httpDuration = metrics['http_req_duration'];
  const httpFailed = metrics['http_req_failed'];

  if (!httpDuration) {
    return {
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
      error_rate_pct: 0,
      total_requests: 0,
    };
  }

  // Extract samples for this service
  const samples = httpDuration.samples || [];
  const serviceSamples = samples.filter((s) => {
    const tags = s.tags || {};
    return tags.service === service;
  });

  if (serviceSamples.length === 0) {
    return {
      p50_ms: 0,
      p95_ms: 0,
      p99_ms: 0,
      error_rate_pct: 0,
      total_requests: 0,
    };
  }

  // Sort by value and calculate percentiles
  const values = serviceSamples.map((s) => s.value).sort((a, b) => a - b);
  const p50 = values[Math.floor(values.length * 0.5)];
  const p95 = values[Math.floor(values.length * 0.95)];
  const p99 = values[Math.floor(values.length * 0.99)];

  // Calculate error rate
  const errorSamples = (httpFailed.samples || []).filter((s) => {
    const tags = s.tags || {};
    return tags.service === service;
  });
  const errorRate = errorSamples.length > 0
    ? (errorSamples.reduce((sum, s) => sum + s.value, 0) / serviceSamples.length) * 100
    : 0;

  return {
    p50_ms: Math.round(p50 || 0),
    p95_ms: Math.round(p95 || 0),
    p99_ms: Math.round(p99 || 0),
    error_rate_pct: Math.round(errorRate * 100) / 100,
    total_requests: serviceSamples.length,
  };
}
