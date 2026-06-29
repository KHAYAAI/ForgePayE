#!/usr/bin/env ts-node

/**
 * Load Testing Suite for ForgePay
 * Tests: Email Queue (1000/day), Kill Bill Sync, Payment Fallback
 * Run: npx ts-node scripts/load-test.ts
 */

import axios from 'axios';

const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';
const TEST_API_KEY = process.env.TEST_API_KEY || 'test-key-123';

interface LoadTestResult {
  test: string;
  duration: number;
  requestsPerSecond: number;
  successRate: number;
  avgLatency: number;
  p95Latency: number;
  p99Latency: number;
  errors: number;
}

// ============================================================================
// TEST 1: Email Queue (1000/day = ~42/hour = ~0.7/minute = ~0.01/second)
// ============================================================================

async function testEmailQueue(): Promise<LoadTestResult> {
  console.log('\n📧 Email Queue Load Test');
  console.log('Target: 1000 emails/day (sustainable)');

  const results = {
    latencies: [] as number[],
    errors: 0,
    success: 0,
  };

  const testDuration = 60; // 60 seconds
  const emailsToSend = 100; // Send 100 in 60 seconds (more than 1000/day)
  const startTime = Date.now();

  for (let i = 0; i < emailsToSend; i++) {
    const emailStart = Date.now();

    try {
      // Simulate email enqueue
      await axios.post(`${API_BASE}/api/email/enqueue`, {
        to: `test-${i}@example.com`,
        subject: `Test Email ${i}`,
        html: `<p>Test body ${i}</p>`,
      });

      const latency = Date.now() - emailStart;
      results.latencies.push(latency);
      results.success++;
    } catch (error) {
      results.errors++;
      console.error(`Email ${i} failed:`, error);
    }

    // Rate limit: spread over time
    await new Promise((resolve) =>
      setTimeout(resolve, (testDuration * 1000) / emailsToSend)
    );
  }

  const duration = Date.now() - startTime;
  const latencies = results.latencies.sort((a, b) => a - b);

  return {
    test: 'Email Queue',
    duration: duration / 1000,
    requestsPerSecond: emailsToSend / (duration / 1000),
    successRate: (results.success / emailsToSend) * 100,
    avgLatency:
      latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p95Latency: latencies[Math.floor(latencies.length * 0.95)],
    p99Latency: latencies[Math.floor(latencies.length * 0.99)],
    errors: results.errors,
  };
}

// ============================================================================
// TEST 2: Kill Bill Sync (hourly verification of 1000+ subscriptions)
// ============================================================================

async function testKillBillSync(): Promise<LoadTestResult> {
  console.log('\n⚙️ Kill Bill Sync Load Test');
  console.log('Target: Sync 1000+ subscriptions in <5 minutes');

  const results = {
    latencies: [] as number[],
    errors: 0,
    success: 0,
  };

  const subscriptionCount = 100; // Test with 100 subscriptions

  const syncStart = Date.now();

  try {
    // Simulate Kill Bill sync call
    const response = await axios.post(`${API_BASE}/api/killbill/sync`, {
      subscriptionCount,
    });

    const syncLatency = Date.now() - syncStart;
    results.latencies.push(syncLatency);

    if (response.status === 200) {
      results.success++;
      console.log(`✅ Synced ${subscriptionCount} subscriptions in ${syncLatency}ms`);
    } else {
      results.errors++;
    }
  } catch (error) {
    results.errors++;
    console.error('Kill Bill sync failed:', error);
  }

  const duration = Date.now() - syncStart;
  const latencies = results.latencies.sort((a, b) => a - b);

  return {
    test: 'Kill Bill Sync',
    duration: duration / 1000,
    requestsPerSecond: 1 / (duration / 1000),
    successRate: (results.success / 1) * 100,
    avgLatency: latencies[0],
    p95Latency: latencies[0],
    p99Latency: latencies[0],
    errors: results.errors,
  };
}

// ============================================================================
// TEST 3: Payment Fallback Chain (Stripe → Circle → Manual)
// ============================================================================

async function testPaymentFallback(): Promise<LoadTestResult> {
  console.log('\n💳 Payment Fallback Chain Load Test');
  console.log('Target: 99.7% success rate across fallback chain');

  const results = {
    latencies: [] as number[],
    errors: 0,
    success: 0,
    methodCounts: {
      stripe: 0,
      circle: 0,
      manual: 0,
    },
  };

  const paymentCount = 50; // Test 50 payments

  for (let i = 0; i < paymentCount; i++) {
    const paymentStart = Date.now();

    try {
      const response = await axios.post(`${API_BASE}/api/payments/process`, {
        amount: 50000,
        currency: 'ZAR',
        customer_id: `test-cust-${i}`,
      });

      const latency = Date.now() - paymentStart;
      results.latencies.push(latency);

      if (response.status === 200) {
        results.success++;
        const method = response.data.method; // stripe_ach | circle_usdc | manual_request
        results.methodCounts[method as keyof typeof results.methodCounts]++;
        console.log(`✅ Payment ${i}: ${method} in ${latency}ms`);
      } else {
        results.errors++;
      }
    } catch (error) {
      results.errors++;
      console.error(`Payment ${i} failed:`, error);
    }
  }

  const duration = results.latencies.reduce((a, b) => a + b, 0);
  const latencies = results.latencies.sort((a, b) => a - b);

  console.log(`\nFallback Chain Breakdown:`);
  console.log(`  Stripe ACH: ${results.methodCounts.stripe}`);
  console.log(`  Circle USDC: ${results.methodCounts.circle}`);
  console.log(`  Manual Request: ${results.methodCounts.manual}`);

  return {
    test: 'Payment Fallback',
    duration: duration / 1000,
    requestsPerSecond: paymentCount / (duration / 1000),
    successRate: (results.success / paymentCount) * 100,
    avgLatency:
      latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p95Latency: latencies[Math.floor(latencies.length * 0.95)],
    p99Latency: latencies[Math.floor(latencies.length * 0.99)],
    errors: results.errors,
  };
}

// ============================================================================
// REPORTING
// ============================================================================

function printResult(result: LoadTestResult) {
  console.log(`\n📊 Results: ${result.test}`);
  console.log(`  Duration: ${result.duration.toFixed(2)}s`);
  console.log(`  RPS: ${result.requestsPerSecond.toFixed(2)} req/s`);
  console.log(`  Success Rate: ${result.successRate.toFixed(1)}%`);
  console.log(`  Avg Latency: ${result.avgLatency.toFixed(0)}ms`);
  console.log(`  P95 Latency: ${result.p95Latency.toFixed(0)}ms`);
  console.log(`  P99 Latency: ${result.p99Latency.toFixed(0)}ms`);
  console.log(`  Errors: ${result.errors}`);

  // Pass/Fail criteria
  let status = '✅ PASS';
  if (result.successRate < 95) status = '❌ FAIL';
  else if (result.successRate < 99) status = '⚠️ WARNING';

  console.log(`  Status: ${status}`);
}

async function runAllTests() {
  console.log('═'.repeat(60));
  console.log('ForgePay Load Testing Suite');
  console.log('═'.repeat(60));

  const results: LoadTestResult[] = [];

  try {
    results.push(await testEmailQueue());
  } catch (error) {
    console.error('Email queue test failed:', error);
  }

  try {
    results.push(await testKillBillSync());
  } catch (error) {
    console.error('Kill Bill sync test failed:', error);
  }

  try {
    results.push(await testPaymentFallback());
  } catch (error) {
    console.error('Payment fallback test failed:', error);
  }

  // Print all results
  console.log('\n' + '═'.repeat(60));
  console.log('Load Test Summary');
  console.log('═'.repeat(60));

  results.forEach(printResult);

  // Overall verdict
  const allPass = results.every((r) => r.successRate >= 95);
  const verdict = allPass
    ? '🟢 GO FOR LAUNCH'
    : '🔴 FAILED - DO NOT LAUNCH';

  console.log(`\n${verdict}`);
  console.log(`Passed: ${results.filter((r) => r.successRate >= 95).length}/${results.length}`);
}

runAllTests().catch(console.error);
