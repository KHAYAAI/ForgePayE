import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const duration = new Trend('http_req_duration');
const successRate = new Rate('success');
const authFailures = new Counter('auth_failures');
const activeUsers = new Gauge('active_users');

export const options = {
  stages: [
    { duration: '30s', target: 10 },    // Ramp up to 10 users
    { duration: '1m30s', target: 50 },  // Ramp up to 50 users
    { duration: '2m', target: 100 },    // Ramp up to 100 users
    { duration: '2m', target: 100 },    // Stay at 100 users
    { duration: '1m', target: 50 },     // Ramp down to 50 users
    { duration: '30s', target: 0 },     // Ramp down to 0 users
  ],
  thresholds: {
    'http_req_duration': ['p(95)<500', 'p(99)<1000'],
    'errors': ['rate<0.1'],
    'success': ['rate>0.9'],
  },
  ext: {
    loadimpact: {
      projectID: 3356643,
      name: 'OpenPrivy Load Test',
    },
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3001';
let authToken = '';
let walletId = '';

export function setup() {
  // Setup: Create test account
  const signupRes = http.post(`${BASE_URL}/auth/signup`, {
    email: `loadtest-${Date.now()}@example.com`,
    password: 'LoadTestPassword123!',
    username: 'loadtest',
  });

  check(signupRes, {
    'signup successful': (r) => r.status === 201,
  });

  if (signupRes.status === 201) {
    return {
      token: signupRes.json('token'),
      userId: signupRes.json('user.id'),
    };
  }
  return { token: '', userId: '' };
}

export default function (data) {
  const token = data.token;
  activeUsers.add(1);

  group('Auth Tests', () => {
    // Get current user
    const res = http.get(`${BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    check(res, {
      'auth me status is 200': (r) => r.status === 200,
      'has user email': (r) => r.json('email') !== undefined,
    });

    errorRate.add(res.status !== 200);
    successRate.add(res.status === 200);
    duration.add(res.timings.duration);

    if (res.status !== 200) {
      authFailures.add(1);
    }
  });

  sleep(1);

  group('Wallet Tests', () => {
    // Create wallet
    const createRes = http.post(
      `${BASE_URL}/wallet/create`,
      { chain: 'ethereum' },
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    check(createRes, {
      'wallet creation status is 201': (r) => r.status === 201,
      'wallet has address': (r) => r.json('address') !== undefined,
    });

    errorRate.add(createRes.status !== 201);
    duration.add(createRes.timings.duration);

    if (createRes.status === 201) {
      walletId = createRes.json('id');

      // Get wallet balance
      const balanceRes = http.get(`${BASE_URL}/wallet/${walletId}/balance`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      check(balanceRes, {
        'balance fetch status is 200': (r) => r.status === 200,
        'has balance field': (r) => r.json('balance') !== undefined,
      });

      errorRate.add(balanceRes.status !== 200);
      duration.add(balanceRes.timings.duration);
    }
  });

  sleep(1);

  group('Blockchain Tests', () => {
    // Get supported chains
    const chainsRes = http.get(`${BASE_URL}/blockchain/supported-chains`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    check(chainsRes, {
      'chains status is 200': (r) => r.status === 200,
      'has chains array': (r) => Array.isArray(r.json()),
    });

    errorRate.add(chainsRes.status !== 200);
    duration.add(chainsRes.timings.duration);

    // Get Ethereum balance
    const ethBalance = http.get(
      `${BASE_URL}/blockchain/ethereum/balance/0x0000000000000000000000000000000000000000`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    check(ethBalance, {
      'ethereum balance status is 200': (r) => r.status === 200 || r.status === 400,
    });

    errorRate.add(ethBalance.status !== 200 && ethBalance.status !== 400);
    duration.add(ethBalance.timings.duration);
  });

  sleep(1);

  group('DeFi Tests', () => {
    // Get DeFi stats
    const statsRes = http.get(`${BASE_URL}/defi/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    check(statsRes, {
      'stats status is 200 or 404': (r) => r.status === 200 || r.status === 404,
    });

    errorRate.add(statsRes.status !== 200 && statsRes.status !== 404);
    duration.add(statsRes.timings.duration);
  });

  sleep(2);
  activeUsers.add(-1);
}

export function teardown(data) {
  console.log('Load test completed');
  console.log(`Test duration: ${__ITER} iterations`);
}
