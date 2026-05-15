import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const registryErrors = new Counter('registry_errors');
const registryLatency = new Trend('registry_latency_ms', true);
const registrySuccess = new Rate('registry_success_rate');

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3008';

export const options = {
  stages: [
    { duration: '1m', target: 10 },
    { duration: '5m', target: 30 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    'registry_latency_ms': ['p(95)<1000'],  // slower due to SQL queries
    'registry_success_rate': ['rate>0.99'],
    'registry_errors': ['count<10'],
  },
};

const MERCHANTS = [
  { id: 'merch_rwa_001', apiKey: 'sk_test_rwa_001' },
  { id: 'merch_rwa_002', apiKey: 'sk_test_rwa_002' },
  { id: 'merch_rwa_003', apiKey: 'sk_test_rwa_003' },
];

const ASSET_SYMBOLS = ['OUSG', 'TBILL', 'USDY'];

export default function () {
  const merchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${merchant.apiKey}`,
  };

  // List assets
  const startTime = Date.now();
  const listRes = http.get(`${BASE_URL}/v1/assets`, { headers });
  registryLatency.add(Date.now() - startTime);

  const listOk = check(listRes, {
    'list assets 200': (r) => r.status === 200,
    'assets is array': (r) => {
      try { return Array.isArray(JSON.parse(r.body)); } catch { return false; }
    },
  });

  registrySuccess.add(listOk);
  if (!listOk) registryErrors.add(1);

  sleep(0.3);

  // Get a single asset by symbol
  const symbol = ASSET_SYMBOLS[Math.floor(Math.random() * ASSET_SYMBOLS.length)];
  const assetRes = http.get(`${BASE_URL}/v1/assets/${symbol}`, { headers });
  const assetOk = check(assetRes, {
    'get asset 200': (r) => r.status === 200,
    'asset has nav': (r) => {
      try { return typeof JSON.parse(r.body).nav !== 'undefined'; } catch { return false; }
    },
  });
  if (!assetOk) registryErrors.add(1);

  sleep(0.3);

  // Create a position
  const posRes = http.post(
    `${BASE_URL}/v1/positions`,
    JSON.stringify({
      merchant_id: merchant.id,
      asset_symbol: symbol,
      amount_usd: (Math.random() * 4900 + 100).toFixed(2),
      idempotency_key: `k6-${Date.now()}-${Math.random()}`,
    }),
    { headers }
  );
  check(posRes, { 'create position 201': (r) => r.status === 201 });

  sleep(0.3);

  // Get income summary
  const incomeRes = http.get(
    `${BASE_URL}/v1/income?merchantId=${merchant.id}`,
    { headers }
  );
  check(incomeRes, { 'income 200': (r) => r.status === 200 });

  sleep(Math.random() * 2 + 1);
}
