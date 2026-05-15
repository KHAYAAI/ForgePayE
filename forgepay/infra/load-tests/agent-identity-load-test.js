import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const errorRate = new Rate('errors');
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3010';

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '5m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

// Pre-register some agents for discovery tests
const AGENT_PAYLOAD = JSON.stringify({
  name: 'test-agent-${__VU}',
  endpoint: 'https://test.forgepay.io/agent',
  capabilities: ['negotiation', 'payment'],
  framework: 'forgepay',
});

export default function () {
  const headers = { 'Content-Type': 'application/json' };

  // Register agent
  const reg = http.post(`${BASE_URL}/v1/agents`, AGENT_PAYLOAD, { headers });
  const regOk = check(reg, { 'register 201': (r) => r.status === 201 });
  errorRate.add(!regOk);

  if (regOk) {
    const agentId = JSON.parse(reg.body).id;

    // Get agent
    const get = http.get(`${BASE_URL}/v1/agents/${agentId}`);
    check(get, { 'get 200': (r) => r.status === 200 });

    // Discover agents
    const disc = http.get(`${BASE_URL}/v1/discover?capability=negotiation`);
    check(disc, { 'discover 200': (r) => r.status === 200 });

    // Health
    const health = http.get(`${BASE_URL}/health`);
    check(health, { 'health 200': (r) => r.status === 200 });
  }

  sleep(0.5);
}
