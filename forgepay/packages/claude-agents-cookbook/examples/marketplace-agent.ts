/**
 * Marketplace Buyer Agent
 *
 * Demonstrates a Claude agent acting as an autonomous buyer in a crypto-native
 * B2B data/API marketplace. The agent:
 *
 *   1. Searches the marketplace for a specific product or dataset
 *   2. Evaluates listings against quality, price, and vendor reputation metrics
 *   3. Requests a detailed price quote from the best vendor
 *   4. Performs due diligence: checks reviews, data sample, and SLA terms
 *   5. Decides whether the price is acceptable against a budget
 *   6. Executes payment via ForgePay x402 if the deal is approved
 *   7. Confirms delivery and verifies the product was received
 *   8. Logs the purchase for accounting
 *
 * This pattern applies to:
 *   - Autonomous API marketplace procurement
 *   - On-chain data licensing
 *   - AI agent-to-agent commerce (agent pays another agent's API)
 *   - B2B SaaS subscription auto-renewal with USDC
 *
 * Run: npx tsx examples/marketplace-agent.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-demo';
const FORGEPAY_API_KEY = process.env.FORGEPAY_API_KEY ?? 'fp_demo_key';
const FORGEPAY_BASE_URL = process.env.FORGEPAY_BASE_URL ?? 'https://api.forgepay.io';
const MARKETPLACE_BASE_URL = process.env.MARKETPLACE_URL ?? 'https://marketplace.example.io';

/** Maximum price in USD the agent is authorized to pay */
const BUDGET_USD = parseFloat(process.env.BUDGET_USD ?? '50');
/** Minimum vendor reputation score (0-100) required */
const MIN_VENDOR_SCORE = parseFloat(process.env.MIN_VENDOR_SCORE ?? '75');
/** Search query */
const SEARCH_QUERY = process.env.SEARCH_QUERY ?? 'real-time ETH gas price oracle';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface MarketplaceListing {
  listing_id: string;
  title: string;
  vendor: string;
  vendor_score: number;  // 0-100 reputation
  description: string;
  price_usd: number;
  price_per: string;  // e.g. "per API call", "per month", "one-time"
  category: string;
  tags: string[];
  reviews_count: number;
  avg_rating: number;  // 1.0-5.0
  uptime_sla: number;  // percentage
  latency_ms_p95: number;
}

interface PriceQuote {
  quote_id: string;
  listing_id: string;
  vendor: string;
  price_usd: number;
  quantity: number;
  subtotal_usd: number;
  discount_pct: number;
  final_price_usd: number;
  currency: string;
  payment_method: string;
  quote_expires_at: string;
  payment_endpoint: string;  // x402 endpoint
  x402_headers: Record<string, string>;
}

interface DueDiligenceResult {
  listing_id: string;
  sample_data?: any;
  recent_reviews: { rating: number; comment: string; date: string }[];
  sla_terms: { uptime: number; support_response_hours: number; refund_policy: string };
  technical_docs_url: string;
  passed: boolean;
  issues: string[];
}

interface PurchaseRecord {
  purchase_id: string;
  listing_id: string;
  vendor: string;
  amount_usd: number;
  txn_hash: string;
  access_key?: string;
  api_endpoint?: string;
  purchased_at: string;
  confirmation_status: string;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function searchMarketplace(
  query: string,
  maxResults: number = 5
): Promise<MarketplaceListing[]> {
  console.log(`[TOOL] search_marketplace: "${query}" (max ${maxResults} results)`);

  try {
    const response = await axios.get(`${MARKETPLACE_BASE_URL}/v1/search`, {
      params: { q: query, limit: maxResults },
      timeout: 10_000,
    });
    return response.data.listings;
  } catch {
    // Realistic demo marketplace data
    console.log('[TOOL] Using demo marketplace listings');
    return [
      {
        listing_id: 'lst_eth_gas_001',
        title: 'Real-Time ETH Gas Price Oracle — 1M API Calls',
        vendor: 'GasWatch Labs',
        vendor_score: 91,
        description:
          'Sub-second ETH gas price data with EIP-1559 base fee, priority fee recommendations ' +
          'across all major chains. WebSocket + REST. 99.9% uptime SLA.',
        price_usd: 12.00,
        price_per: '1M API calls',
        category: 'blockchain-data',
        tags: ['ethereum', 'gas', 'oracle', 'eip-1559', 'base', 'polygon'],
        reviews_count: 234,
        avg_rating: 4.7,
        uptime_sla: 99.9,
        latency_ms_p95: 45,
      },
      {
        listing_id: 'lst_eth_gas_002',
        title: 'ETH Gas Tracker API — Enterprise',
        vendor: 'ChainMetrics',
        vendor_score: 84,
        description:
          'Gas price tracking with historical data, percentile analysis, and predictive ' +
          'recommendations. Includes Ethereum, Base, Arbitrum, and Optimism.',
        price_usd: 29.99,
        price_per: 'per month',
        category: 'blockchain-data',
        tags: ['ethereum', 'gas', 'analytics', 'historical'],
        reviews_count: 89,
        avg_rating: 4.3,
        uptime_sla: 99.5,
        latency_ms_p95: 120,
      },
      {
        listing_id: 'lst_eth_gas_003',
        title: 'Lightweight Gas Price Feed',
        vendor: 'QuickNode Partner',
        vendor_score: 62,
        description: 'Basic gas price feed with 5-second refresh. Simple REST API.',
        price_usd: 4.99,
        price_per: 'per month',
        category: 'blockchain-data',
        tags: ['ethereum', 'gas', 'basic'],
        reviews_count: 17,
        avg_rating: 3.1,
        uptime_sla: 98.0,
        latency_ms_p95: 300,
      },
    ];
  }
}

async function getPriceQuote(listingId: string, quantity: number = 1): Promise<PriceQuote> {
  console.log(`[TOOL] get_price_quote: listing=${listingId}, qty=${quantity}`);

  try {
    const response = await axios.post(
      `${MARKETPLACE_BASE_URL}/v1/quotes`,
      { listing_id: listingId, quantity },
      { timeout: 10_000 }
    );
    return response.data;
  } catch {
    const listings: Record<string, { price: number; vendor: string }> = {
      lst_eth_gas_001: { price: 12.00, vendor: 'GasWatch Labs' },
      lst_eth_gas_002: { price: 29.99, vendor: 'ChainMetrics' },
      lst_eth_gas_003: { price: 4.99, vendor: 'QuickNode Partner' },
    };

    const listing = listings[listingId] ?? { price: 10.00, vendor: 'Unknown Vendor' };
    const finalPrice = listing.price * quantity;

    const x402Headers: Record<string, string> = {
      'x-402-version': '1',
      'x-402-scheme': 'x402',
      'x-402-max-amount': finalPrice.toFixed(2),
      'x-402-asset': 'USDC',
      'x-402-payment-endpoint': `${FORGEPAY_BASE_URL}/v1/x402/pay`,
      'x-402-chain': 'base',
    };

    return {
      quote_id: `q_${Date.now()}`,
      listing_id: listingId,
      vendor: listing.vendor,
      price_usd: listing.price,
      quantity,
      subtotal_usd: finalPrice,
      discount_pct: quantity > 1 ? 10 : 0,
      final_price_usd: quantity > 1 ? finalPrice * 0.9 : finalPrice,
      currency: 'USDC',
      payment_method: 'x402',
      quote_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      payment_endpoint: `${FORGEPAY_BASE_URL}/v1/x402/pay`,
      x402_headers: x402Headers,
    };
  }
}

async function performDueDiligence(listingId: string): Promise<DueDiligenceResult> {
  console.log(`[TOOL] perform_due_diligence: ${listingId}`);

  try {
    const response = await axios.get(
      `${MARKETPLACE_BASE_URL}/v1/listings/${listingId}/due-diligence`,
      { timeout: 15_000 }
    );
    return response.data;
  } catch {
    // Simulate due diligence data for lst_eth_gas_001
    const isPrimary = listingId === 'lst_eth_gas_001';
    return {
      listing_id: listingId,
      sample_data: isPrimary
        ? {
            timestamp: new Date().toISOString(),
            network: 'ethereum',
            base_fee_gwei: '28.4',
            priority_fee_slow_gwei: '0.5',
            priority_fee_standard_gwei: '1.2',
            priority_fee_fast_gwei: '2.0',
            estimated_wait_slow_s: 120,
            estimated_wait_standard_s: 30,
            estimated_wait_fast_s: 12,
          }
        : null,
      recent_reviews: isPrimary
        ? [
            { rating: 5, comment: 'Very reliable, never had downtime issues', date: '2026-05-01' },
            { rating: 5, comment: 'Excellent latency, great for trading bots', date: '2026-04-28' },
            { rating: 4, comment: 'Good data quality, docs could be better', date: '2026-04-15' },
          ]
        : [
            { rating: 3, comment: 'Average quality', date: '2026-04-20' },
          ],
      sla_terms: {
        uptime: isPrimary ? 99.9 : 98.0,
        support_response_hours: isPrimary ? 4 : 48,
        refund_policy: isPrimary ? 'Pro-rated refund within 7 days' : 'No refunds',
      },
      technical_docs_url: `https://docs.example.io/${listingId}`,
      passed: isPrimary,
      issues: isPrimary ? [] : ['Below minimum reputation score', 'Low review count'],
    };
  }
}

async function executePayment(quote: PriceQuote): Promise<{
  txnHash: string;
  paymentToken: string;
  amount: number;
  currency: string;
  confirmationTimeMs: number;
}> {
  console.log(
    `[TOOL] execute_payment: $${quote.final_price_usd} USDC to ${quote.vendor} ` +
    `(quote ${quote.quote_id})`
  );
  const start = Date.now();

  try {
    const response = await axios.post(
      `${FORGEPAY_BASE_URL}/v1/x402/pay`,
      {
        amount: quote.final_price_usd,
        currency: 'USDC',
        chain: 'base',
        payment_endpoint: quote.payment_endpoint,
        description: `Marketplace purchase: ${quote.listing_id} from ${quote.vendor}`,
        quote_id: quote.quote_id,
      },
      {
        headers: { 'x-api-key': FORGEPAY_API_KEY, 'Content-Type': 'application/json' },
        timeout: 30_000,
      }
    );

    return {
      txnHash: response.data.txn_hash,
      paymentToken: response.data.payment_token,
      amount: quote.final_price_usd,
      currency: 'USDC',
      confirmationTimeMs: Date.now() - start,
    };
  } catch {
    // Demo payment
    const simulatedHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;
    console.log(`[TOOL] Demo payment: ${simulatedHash.slice(0, 16)}...`);
    return {
      txnHash: simulatedHash,
      paymentToken: `pt_${Date.now()}`,
      amount: quote.final_price_usd,
      currency: 'USDC',
      confirmationTimeMs: Date.now() - start,
    };
  }
}

async function confirmDelivery(
  listingId: string,
  paymentToken: string
): Promise<PurchaseRecord> {
  console.log(`[TOOL] confirm_delivery: ${listingId}`);

  try {
    const response = await axios.post(
      `${MARKETPLACE_BASE_URL}/v1/purchases/confirm`,
      { listing_id: listingId, payment_token: paymentToken },
      { timeout: 15_000 }
    );
    return response.data;
  } catch {
    // Simulate delivery confirmation
    return {
      purchase_id: `pur_${Date.now()}`,
      listing_id: listingId,
      vendor: 'GasWatch Labs',
      amount_usd: 12.00,
      txn_hash: paymentToken,
      access_key: `ak_${Math.random().toString(36).slice(2, 18)}`,
      api_endpoint: 'https://api.gaswatch.io/v2',
      purchased_at: new Date().toISOString(),
      confirmation_status: 'delivered',
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions for Claude
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: 'search_marketplace',
    description:
      'Search the ForgePay API marketplace for products, data feeds, or services. Returns a ' +
      'ranked list of listings with pricing, vendor reputation, ratings, and SLA information.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query describing what you need' },
        max_results: { type: 'number', description: 'Maximum results to return (1-20). Default: 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_price_quote',
    description:
      'Request a formal price quote for a marketplace listing. Returns exact pricing, any ' +
      'applicable discounts, quote expiry, and x402 payment headers to use for checkout.',
    input_schema: {
      type: 'object',
      properties: {
        listing_id: { type: 'string', description: 'Listing ID from search results' },
        quantity: { type: 'number', description: 'Quantity (for volume pricing). Default: 1.' },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'perform_due_diligence',
    description:
      'Perform due diligence on a marketplace listing before purchasing. Fetches a data sample, ' +
      'recent reviews, SLA terms, and technical documentation. Returns a pass/fail assessment.',
    input_schema: {
      type: 'object',
      properties: {
        listing_id: { type: 'string', description: 'Listing ID to evaluate' },
      },
      required: ['listing_id'],
    },
  },
  {
    name: 'execute_payment',
    description:
      'Execute the payment for a marketplace quote using ForgePay USDC. Uses x402 protocol for ' +
      'instant crypto checkout. Returns transaction hash and payment token for delivery confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        quote: {
          type: 'object',
          description: 'Full quote object from get_price_quote',
        },
      },
      required: ['quote'],
    },
  },
  {
    name: 'confirm_delivery',
    description:
      'Confirm that the purchased product was delivered after payment. Provides the payment token ' +
      'as proof of payment and receives the API key, access credentials, or download link.',
    input_schema: {
      type: 'object',
      properties: {
        listing_id: { type: 'string' },
        payment_token: { type: 'string', description: 'Payment token from execute_payment result' },
      },
      required: ['listing_id', 'payment_token'],
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
    case 'search_marketplace':
      return JSON.stringify(
        await searchMarketplace(input.query as string, input.max_results as number),
        null,
        2
      );
    case 'get_price_quote':
      return JSON.stringify(
        await getPriceQuote(input.listing_id as string, input.quantity as number),
        null,
        2
      );
    case 'perform_due_diligence':
      return JSON.stringify(await performDueDiligence(input.listing_id as string), null, 2);
    case 'execute_payment':
      return JSON.stringify(await executePayment(input.quote as PriceQuote), null, 2);
    case 'confirm_delivery':
      return JSON.stringify(
        await confirmDelivery(input.listing_id as string, input.payment_token as string),
        null,
        2
      );
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// Agent agentic loop
// ---------------------------------------------------------------------------
async function runMarketplaceAgent(): Promise<void> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are a ForgePay Marketplace Buyer Agent. Your role is to autonomously
procure APIs, data feeds, and digital services from the marketplace on behalf of the user.

Procurement guidelines:
- Budget: $${BUDGET_USD} USD maximum per purchase (do not exceed this)
- Minimum vendor reputation score: ${MIN_VENDOR_SCORE}/100 (reject vendors below this)
- Always perform due diligence before purchasing — check the data sample and reviews
- Prefer vendors with 4.0+ average rating and 99%+ uptime SLA
- Always confirm delivery after payment to obtain access credentials
- If due diligence fails or vendor score is below threshold, explain why and stop

Decision criteria for purchase approval:
  1. Vendor score >= ${MIN_VENDOR_SCORE}
  2. Final price <= $${BUDGET_USD}
  3. Due diligence passes (sample data valid, reviews positive, SLA acceptable)
  4. Rating >= 4.0

After completing a purchase, provide:
- What was purchased and from whom
- Price paid (with transaction hash)
- Access credentials or API endpoint received
- Estimated value vs cost assessment`;

  const userMessage =
    `Please find and purchase a "${SEARCH_QUERY}" from the marketplace. ` +
    `My budget is $${BUDGET_USD} USD. Use ForgePay USDC for payment. ` +
    `Perform due diligence before buying and confirm delivery.`;

  console.log('\n=== ForgePay Marketplace Buyer Agent ===');
  console.log(`Search query: "${SEARCH_QUERY}"`);
  console.log(`Budget: $${BUDGET_USD} USD`);
  console.log(`Min vendor score: ${MIN_VENDOR_SCORE}/100`);
  console.log('Starting procurement workflow...\n');

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  const maxIterations = 15;

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
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      console.log('\n=== Purchase Complete ===');
      for (const block of response.content) {
        if (block.type === 'text') {
          console.log(block.text);
        }
      }
      break;
    }

    if (response.stop_reason === 'tool_use') {
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          console.log(`\nCalling tool: ${block.name}`);

          const result = await dispatchTool(block.name, block.input as Record<string, any>);
          console.log('Result preview:', result.slice(0, 300) + (result.length > 300 ? '...' : ''));

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
    console.log('\nMax iterations reached.');
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
runMarketplaceAgent().catch((err) => {
  console.error('Marketplace agent error:', err.message);
  process.exit(1);
});
