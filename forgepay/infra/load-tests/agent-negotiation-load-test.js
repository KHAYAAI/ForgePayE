import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const sessionErrors = new Counter('session_errors');
const sessionLatency = new Trend('session_latency_ms', true);
const sessionSuccess = new Rate('session_success_rate');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3011';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '5m', target: 30 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'session_latency_ms': ['p(95)<800'],
    'session_success_rate': ['rate>0.99'],
    'session_errors': ['count<10'],
  },
};

const AGENTS = [
  { id: 'agent_test_001', apiKey: 'sk_test_agent_001' },
  { id: 'agent_test_002', apiKey: 'sk_test_agent_002' },
  { id: 'agent_test_003', apiKey: 'sk_test_agent_003' },
];

export default function () {
  const buyer  = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const seller = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${buyer.apiKey}`,
  };

  // Create negotiation session
  const startTime = Date.now();
  const createRes = http.post(
    `${BASE_URL}/v1/sessions`,
    JSON.stringify({
      buyer_agent_id: buyer.id,
      seller_agent_id: seller.id,
      asset: 'USDC',
      amount: (Math.random() * 990 + 10).toFixed(2),
      idempotency_key: `k6-${Date.now()}-${Math.random()}`,
    }),
    { headers }
  );

  sessionLatency.add(Date.now() - startTime);

  const ok = check(createRes, {
    'create session 201': (r) => r.status === 201,
    'session has id': (r) => {
      try { return !!JSON.parse(r.body).id; } catch { return false; }
    },
  });

  sessionSuccess.add(ok);
  if (!ok) {
    sessionErrors.add(1);
    sleep(1);
    return;
  }

  const sessionId = JSON.parse(createRes.body).id;

  sleep(0.3);

  // Poll session state
  const pollRes = http.get(`${BASE_URL}/v1/sessions/${sessionId}`, { headers });
  check(pollRes, { 'get session 200': (r) => r.status === 200 });

  sleep(0.2);

  // Add a negotiation message
  const msgRes = http.post(
    `${BASE_URL}/v1/sessions/${sessionId}/messages`,
    JSON.stringify({
      role: 'buyer',
      content: 'Proposing counter-offer at 0.5% discount.',
    }),
    { headers }
  );
  check(msgRes, { 'message 201': (r) => r.status === 201 });

  sleep(Math.random() * 1.5 + 0.5);
}
