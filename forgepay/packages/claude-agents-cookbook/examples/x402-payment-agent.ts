/**
 * x402 Payment Agent
 *
 * Demonstrates a Claude agent that autonomously handles HTTP 402 Payment Required
 * responses using the x402 protocol and ForgePay stablecoin gateway.
 *
 * Workflow:
 *   1. Agent attempts to access a premium data API endpoint
 *   2. The API returns HTTP 402 with x402 headers specifying a USDC payment
 *   3. Agent parses the headers, checks its balance, and pays via ForgePay
 *   4. Agent retries the original request with payment proof
 *   5. Agent processes and reports the data it received
 *
 * Run: npx tsx examples/x402-payment-agent.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Configuration — set these via environment variables in production
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-demo';
const FORGEPAY_API_KEY = process.env.FORGEPAY_API_KEY ?? 'fp_demo_key';
const FORGEPAY_BASE_URL = process.env.FORGEPAY_BASE_URL ?? 'https://api.forgepay.io';

// The paid data endpoint we want to access
const PREMIUM_ENDPOINT = process.env.PREMIUM_API_URL ?? 'https://data.example.io/v1/market/crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface X402Headers {
  version: string;
  scheme: string;
  maxAmountRequired: number;
  asset: string;
  paymentEndpoint: string;
  chain: string;
}

interface ApiResponse {
  status: number;
  data?: any;
  x402Headers?: X402Headers;
  error?: string;
}

interface PaymentResult {
  success: boolean;
  txnHash?: string;
  amount?: number;
  currency?: string;
  confirmationTimeMs?: number;
  paymentToken?: string;
  error?: string;
}

interface BalanceResult {
  usdc: number;
  usdt: number;
  totalUsd: number;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function checkApiEndpoint(url: string): Promise<ApiResponse> {
  console.log(`[TOOL] check_api_endpoint: GET ${url}`);
  try {
    const response = await axios.get(url, {
      timeout: 15_000,
      validateStatus: () => true, // don't throw on 4xx/5xx
    });

    if (response.status === 402) {
      const headers = response.headers as Record<string, string>;
      return {
        status: 402,
        error: 'HTTP 402 Payment Required',
        x402Headers: {
          version: headers['x-402-version'] ?? '1',
          scheme: headers['x-402-scheme'] ?? 'x402',
          maxAmountRequired: parseFloat(headers['x-402-max-amount'] ?? '1.00'),
          asset: headers['x-402-asset'] ?? 'USDC',
          paymentEndpoint: headers['x-402-payment-endpoint'] ?? `${FORGEPAY_BASE_URL}/v1/x402/pay`,
          chain: headers['x-402-chain'] ?? 'base',
        },
      };
    }

    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, data: response.data };
    }

    return { status: response.status, error: `HTTP ${response.status}: ${response.statusText}` };
  } catch (err: any) {
    // Simulate a 402 response for demo purposes when the endpoint is unreachable
    console.log(`[TOOL] Endpoint unreachable — simulating x402 response for demo`);
    return {
      status: 402,
      error: 'HTTP 402 Payment Required (simulated)',
      x402Headers: {
        version: '1',
        scheme: 'x402',
        maxAmountRequired: 0.50,
        asset: 'USDC',
        paymentEndpoint: `${FORGEPAY_BASE_URL}/v1/x402/pay`,
        chain: 'base',
      },
    };
  }
}

async function checkBalance(): Promise<BalanceResult> {
  console.log(`[TOOL] check_forgepay_balance`);
  try {
    const response = await axios.get(`${FORGEPAY_BASE_URL}/v1/accounts/balance`, {
      headers: { 'x-api-key': FORGEPAY_API_KEY },
      timeout: 10_000,
    });
    const usdc = response.data.usdc ?? 0;
    const usdt = response.data.usdt ?? 0;
    return { usdc, usdt, totalUsd: usdc + usdt };
  } catch {
    // Return a realistic demo balance when API isn't available
    console.log(`[TOOL] Using demo balance: $250.00 USDC`);
    return { usdc: 250.00, usdt: 100.00, totalUsd: 350.00 };
  }
}

async function payX402(x402Info: X402Headers): Promise<PaymentResult> {
  console.log(
    `[TOOL] pay_x402: paying ${x402Info.maxAmountRequired} ${x402Info.asset} on ${x402Info.chain}`
  );
  const start = Date.now();

  try {
    const response = await axios.post(
      `${FORGEPAY_BASE_URL}/v1/x402/pay`,
      {
        amount: x402Info.maxAmountRequired,
        currency: x402Info.asset,
        chain: x402Info.chain,
        payment_endpoint: x402Info.paymentEndpoint,
      },
      {
        headers: { 'x-api-key': FORGEPAY_API_KEY, 'Content-Type': 'application/json' },
        timeout: 30_000,
      }
    );

    return {
      success: true,
      txnHash: response.data.txn_hash,
      amount: x402Info.maxAmountRequired,
      currency: x402Info.asset,
      confirmationTimeMs: Date.now() - start,
      paymentToken: response.data.payment_token,
    };
  } catch {
    // Simulate success for demo
    const simulatedHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;
    console.log(`[TOOL] Demo payment — simulated txn hash: ${simulatedHash.slice(0, 10)}...`);
    return {
      success: true,
      txnHash: simulatedHash,
      amount: x402Info.maxAmountRequired,
      currency: x402Info.asset,
      confirmationTimeMs: Date.now() - start,
      paymentToken: `pt_${Date.now()}`,
    };
  }
}

async function retryWithProof(url: string, paymentToken: string): Promise<ApiResponse> {
  console.log(`[TOOL] retry_with_proof: GET ${url} (with payment-token: ${paymentToken.slice(0, 12)}...)`);
  try {
    const response = await axios.get(url, {
      headers: { 'x-payment-token': paymentToken, 'x-forgepay-merchant': 'demo' },
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (response.status >= 200 && response.status < 300) {
      return { status: response.status, data: response.data };
    }
    return { status: response.status, error: `HTTP ${response.status}` };
  } catch {
    // Simulate a successful data response for demo
    console.log(`[TOOL] Simulating successful data response after payment`);
    return {
      status: 200,
      data: {
        timestamp: new Date().toISOString(),
        prices: {
          BTC: { usd: 67420.15, change_24h: 2.34 },
          ETH: { usd: 3812.44, change_24h: 1.87 },
          SOL: { usd: 178.92, change_24h: -0.54 },
          USDC: { usd: 1.0002, change_24h: 0.01 },
        },
        market_cap_total_usd: 2_380_000_000_000,
        dominance: { BTC: 52.4, ETH: 17.2 },
        source: 'premium-crypto-data-api',
        paid_with: 'USDC via ForgePay x402',
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions for Claude
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: 'check_api_endpoint',
    description:
      'Make an HTTP GET request to an API endpoint. Returns the status code, response data, ' +
      'and — if the server responds with HTTP 402 — the x402 payment headers specifying the ' +
      'required payment amount, asset, chain, and payment endpoint.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Full URL to request (https://...)' },
      },
      required: ['url'],
    },
  },
  {
    name: 'check_forgepay_balance',
    description:
      'Check the current USDC and USDT balance in the ForgePay account to verify there ' +
      'are sufficient funds before attempting a payment.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pay_x402',
    description:
      'Pay an x402 HTTP 402 payment challenge using ForgePay. Provide the payment info ' +
      'extracted from the 402 response headers. Returns a payment token to use when retrying ' +
      'the original request.',
    input_schema: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        scheme: { type: 'string' },
        maxAmountRequired: { type: 'number', description: 'Amount in USD-equivalent' },
        asset: { type: 'string', description: 'Stablecoin (USDC or USDT)' },
        paymentEndpoint: { type: 'string', description: 'Payment endpoint URL from x402 header' },
        chain: { type: 'string', description: 'Blockchain (base, ethereum, polygon, arbitrum)' },
      },
      required: ['maxAmountRequired', 'asset', 'paymentEndpoint', 'chain'],
    },
  },
  {
    name: 'retry_with_proof',
    description:
      'Retry the original API request, attaching the payment token obtained from pay_x402 ' +
      'as proof of payment. The server will validate the payment and return the protected data.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The same URL that returned HTTP 402' },
        paymentToken: { type: 'string', description: 'Payment token from pay_x402 result' },
      },
      required: ['url', 'paymentToken'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool dispatcher
// ---------------------------------------------------------------------------
async function dispatchTool(
  name: string,
  input: Record<string, any>
): Promise<string> {
  switch (name) {
    case 'check_api_endpoint': {
      const result = await checkApiEndpoint(input.url as string);
      return JSON.stringify(result, null, 2);
    }
    case 'check_forgepay_balance': {
      const result = await checkBalance();
      return JSON.stringify(result, null, 2);
    }
    case 'pay_x402': {
      const result = await payX402(input as X402Headers);
      return JSON.stringify(result, null, 2);
    }
    case 'retry_with_proof': {
      const result = await retryWithProof(
        input.url as string,
        input.paymentToken as string
      );
      return JSON.stringify(result, null, 2);
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// Agent agentic loop
// ---------------------------------------------------------------------------
async function runX402Agent(): Promise<void> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are a ForgePay x402 payment agent. Your goal is to access premium
API data that may require micropayments. When you encounter an HTTP 402 Payment Required
response, you should:
1. Parse the x402 payment headers to understand what payment is needed
2. Check your ForgePay balance to confirm you have sufficient funds
3. Execute the payment using pay_x402
4. Retry the request with the payment proof using retry_with_proof
5. Process and summarize the data you received

You have a ForgePay account with USDC for autonomous payments. Always be economical —
only pay if the data is worth the cost. Report the transaction hash and confirmation time
after each payment.`;

  const userMessage = `Please access the premium crypto market data API at ${PREMIUM_ENDPOINT}
and give me a summary of current crypto prices. If the endpoint requires payment, handle
it automatically using ForgePay. I authorize up to $5 USDC for this data.`;

  console.log('\n=== ForgePay x402 Payment Agent ===');
  console.log(`Target endpoint: ${PREMIUM_ENDPOINT}`);
  console.log('Starting agent loop...\n');

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  const maxIterations = 10;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n--- Agent iteration ${iteration} ---`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: systemPrompt,
      tools,
      messages,
    });

    console.log(`Stop reason: ${response.stop_reason}`);

    // Add assistant's response to history
    messages.push({ role: 'assistant', content: response.content });

    // If no tool use, the agent is done
    if (response.stop_reason === 'end_turn') {
      console.log('\n=== Agent Final Response ===');
      for (const block of response.content) {
        if (block.type === 'text') {
          console.log(block.text);
        }
      }
      break;
    }

    // Process tool calls
    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`\nCalling tool: ${block.name}`);
          console.log('Input:', JSON.stringify(block.input, null, 2));

          const result = await dispatchTool(block.name, block.input as Record<string, any>);

          console.log('Result:', result);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  }

  if (iteration >= maxIterations) {
    console.log('\nMax iterations reached — agent stopped.');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
runX402Agent().catch((err) => {
  console.error('Agent error:', err.message);
  process.exit(1);
});
