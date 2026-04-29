import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const invoiceErrors = new Counter('invoice_errors');
const invoiceLatency = new Trend('invoice_latency_ms', true);
const invoiceSuccess = new Rate('invoice_success_rate');

export const options = {
  stages: [
    { duration: '1m',  target: 5  },
    { duration: '5m',  target: 20 },
    { duration: '1m',  target: 0  },
  ],
  thresholds: {
    'invoice_latency_ms': ['p(95)<800'],
    'invoice_success_rate': ['rate>0.99'],
    'invoice_errors': ['count<10'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:8030';
const COINS = ['BTC', 'ETH', 'LTC'];
const MERCHANTS = [
  { id: 'merch_001', apiKey: 'sk_test_crypto_001' },
  { id: 'merch_002', apiKey: 'sk_test_crypto_002' },
  { id: 'merch_003', apiKey: 'sk_test_crypto_003' },
];

export default function () {
  const merchant = MERCHANTS[Math.floor(Math.random() * MERCHANTS.length)];
  const coin = COINS[Math.floor(Math.random() * COINS.length)];

  const start = Date.now();
  const res = http.post(
    `${BASE_URL}/invoices`,
    JSON.stringify({
      merchant_id: merchant.id,
      coin,
      amount_usd: (Math.random() * 500 + 5).toFixed(2),
      idempotency_key: `k6-${Date.now()}-${Math.random()}`,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${merchant.apiKey}`,
      },
    }
  );

  invoiceLatency.add(Date.now() - start);

  const ok = check(res, {
    'invoice 200 or 201': (r) => r.status === 200 || r.status === 201,
    'invoice has address': (r) => {
      try { return !!JSON.parse(r.body).address; } catch { return false; }
    },
  });

  invoiceSuccess.add(ok);
  if (!ok) invoiceErrors.add(1);

  sleep(Math.random() * 2 + 1);
}
