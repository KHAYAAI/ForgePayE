import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const depositErrors = new Counter('deposit_errors');
const depositLatency = new Trend('deposit_latency_ms', true);
const depositSuccess = new Rate('deposit_success_rate');

export const options = {
  stages: [
    { duration: '1m',  target: 5  },
    { duration: '5m',  target: 30 },
    { duration: '1m',  target: 0  },
  ],
  thresholds: {
    'deposit_latency_ms': ['p(95)<1000'],
    'deposit_success_rate': ['rate>0.995'],
    'deposit_errors': ['count<5'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8020';

const MERCHANTS = [
  { id: 'merch_test_001', apiKey: 'sk_test_stablecoin_001' },
  { id: 'merch_test_002', apiKey: 'sk_test_stablecoin_002' },
];

const CHAINS = ['ethereum', 'base', 'polygon', 'arbitrum'];
const ASSETS = ['USDC', 'USDT'];

export default function () {
  const merchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
  const chain = CHAINS[Math.floor(Math.random() * CHAINS.length)];
  const asset = ASSETS[Math.floor(Math.random() * ASSETS.length)];

  // Test 1: Generate deposit address
  const startTime = Date.now();
  const depositRes = http.post(
    `${BASE_URL}/deposits`,
    JSON.stringify({
      merchant_id: merchant.id,
      asset,
      chain,
      amount_usd: (Math.random() * 990 + 10).toFixed(2),
      idempotency_key: `k6-${Date.now()}-${Math.random()}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${merchant.apiKey}`,
      },
    }
  );

  depositLatency.add(Date.now() - startTime);

  const ok = check(depositRes, {
    'deposit status 200 or 201': (r) => r.status === 200 || r.status === 201,
    'deposit has address': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!body.address;
      } catch { return false; }
    },
  });

  depositSuccess.add(ok);
  if (!ok) depositErrors.add(1);

  sleep(Math.random() * 2 + 0.5);

  // Test 2: Check deposit status (if we got an ID)
  if (depositRes.status === 200 || depositRes.status === 201) {
    try {
      const body = JSON.parse(depositRes.body);
      if (body.id) {
        http.get(`${BASE_URL}/deposits/${body.id}`, {
          headers: { 'Authorization': `Bearer ${merchant.apiKey}` },
        });
      }
    } catch {}
  }

  sleep(Math.random() * 1.5 + 0.5);
}
