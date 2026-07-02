import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';

// Custom metrics
const errorRate = new Rate('error_rate');
const requestDuration = new Trend('request_duration');
const requestCount = new Counter('request_count');
const virtualUsers = new Gauge('virtual_users');

export const options = {
  stages: [
    { duration: '2m', target: 50 },     // Warm up: 50 VUs
    { duration: '3m', target: 100 },    // Ramp up to 100 RPS
    { duration: '3m', target: 250 },    // Ramp up to 250 RPS
    { duration: '3m', target: 500 },    // Ramp up to 500 RPS
    { duration: '5m', target: 1000 },   // Ramp up to 1000 RPS (peak)
    { duration: '5m', target: 1000 },   // Sustain peak load
    { duration: '3m', target: 500 },    // Ramp down to 500 RPS
    { duration: '3m', target: 100 },    // Ramp down to 100 RPS
    { duration: '2m', target: 0 },      // Cool down
  ],
  thresholds: {
    // Latency thresholds
    'http_req_duration{staticAsset:no}': ['p(99)<1000', 'p(95)<500', 'p(50)<200'],
    'http_req_duration{staticAsset:yes}': ['p(99)<1000', 'p(95)<300'],

    // Error rate thresholds
    'http_req_failed': ['rate<0.05'],  // <5% error rate
    'error_rate': ['rate<0.05'],

    // Success rate
    'http_requests': ['rate>0.95'],  // >95% success
  },
  ext: {
    loadimpact: {
      projectID: 3136159,
      name: 'OpenPrivy Staging Load Test',
    },
  },
};

export default function () {
  virtualUsers.set(__VU);

  // Group 1: Health and metrics endpoints
  group('Health Checks', () => {
    healthCheck();
  });

  // Group 2: API endpoints
  group('API Endpoints', () => {
    apiTest();
  });

  // Group 3: Authentication flow
  group('Authentication', () => {
    authTest();
  });

  // Group 4: Wallet operations
  group('Wallet Operations', () => {
    walletTest();
  });

  // Brief pause between iterations
  sleep(1);
}

/**
 * Health check endpoint
 */
function healthCheck() {
  const res = http.get(`${BASE_URL}/health`, {
    tags: { name: 'Health' },
  });

  const success = check(res, {
    'health status 200': (r) => r.status === 200,
    'health has timestamp': (r) => r.body.includes('timestamp'),
  });

  errorRate.add(!success);
  requestCount.add(1);
  requestDuration.add(res.timings.duration);
}

/**
 * Metrics endpoint
 */
function metricsCheck() {
  const res = http.get(`${BASE_URL}/metrics`, {
    tags: { name: 'Metrics' },
  });

  const success = check(res, {
    'metrics status 200': (r) => r.status === 200,
    'metrics has content': (r) => r.body.length > 0,
  });

  errorRate.add(!success);
  requestCount.add(1);
  requestDuration.add(res.timings.duration);
}

/**
 * Generic API test
 */
function apiTest() {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'k6-load-test',
  };

  // GET /api/status
  let res = http.get(`${BASE_URL}/api/status`, { headers, tags: { name: 'GetStatus' } });
  let success = check(res, {
    'GET /api/status 200': (r) => r.status === 200,
  });

  errorRate.add(!success);
  requestCount.add(1);
  requestDuration.add(res.timings.duration);

  sleep(0.5);
}

/**
 * Authentication flow test
 */
function authTest() {
  const headers = {
    'Content-Type': 'application/json',
  };

  // Simulate login attempt (expected to fail or succeed based on credentials)
  const loginPayload = JSON.stringify({
    email: `testuser+${__VU}+${Date.now()}@example.com`,
    password: 'TempPassword123!',
  });

  let res = http.post(`${BASE_URL}/auth/login`, loginPayload, {
    headers,
    tags: { name: 'Login' },
  });

  // We expect either 400 (bad credentials) or 200 (success)
  let success = check(res, {
    'auth endpoint responds': (r) => r.status === 200 || r.status === 400 || r.status === 401,
  });

  errorRate.add(!success);
  requestCount.add(1);
  requestDuration.add(res.timings.duration);

  sleep(0.5);
}

/**
 * Wallet operations test
 */
function walletTest() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer dummy-token-${__VU}`,
  };

  // GET /api/wallets - retrieve wallets (may 401 without valid token, which is expected)
  let res = http.get(`${BASE_URL}/api/wallets`, {
    headers,
    tags: { name: 'GetWallets' },
  });

  // Expect 200 (authorized) or 401/403 (not authorized) - both are valid
  let success = check(res, {
    'wallet list endpoint responds': (r) => r.status >= 200 && r.status < 500,
  });

  errorRate.add(!success);
  requestCount.add(1);
  requestDuration.add(res.timings.duration);

  sleep(0.5);
}

/**
 * Logout/Cleanup
 */
export function teardown(data) {
  // Optional: cleanup after load test
  const summary = `
  Load Test Complete
  ==================
  Total Requests: ${requestCount.value}
  Error Rate: ${((errorRate.value) * 100).toFixed(2)}%
  Avg Duration: ${requestDuration.value.toFixed(0)}ms
  `;
  console.log(summary);
}
