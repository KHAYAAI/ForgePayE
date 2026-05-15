# ForgePay Claude Agents Cookbook

Example Claude AI agents that use ForgePay for autonomous USDC payments,
x402 protocol handling, treasury management, and marketplace procurement.

---

## What Is ForgePay?

ForgePay is a unified payments and treasury platform for AI agents and
crypto-native businesses. It lets software — including AI agents — make
and receive stablecoin payments (USDC/USDT) in real-time on Base, Ethereum,
Polygon, and Arbitrum.

Key capabilities:
- **x402 Protocol** — Agents handle HTTP 402 Payment Required responses
  autonomously: detect, pay, and retry in a single agentic loop iteration
- **Stablecoin Gateway** — USDC/USDT transfers with 2-second settlement on Base
- **Treasury Management** — Yield optimization, DeFi sweeps, multi-chain positions
- **Crypto Invoicing** — BTC, ETH, LTC, SOL, XMR payment invoices
- **Merchant Dashboard** — Full visibility into agent payment activity

---

## The x402 Protocol

x402 is an HTTP extension that enables machine-readable micropayment
negotiation. When a server requires payment for a resource, it responds
with HTTP 402 and a set of `x-402-*` headers:

```
HTTP/1.1 402 Payment Required
x-402-version: 1
x-402-scheme: x402
x-402-max-amount: 0.50
x-402-asset: USDC
x-402-payment-endpoint: https://api.forgepay.io/v1/x402/pay
x-402-chain: base
```

An x402-capable agent:
1. Reads the headers and understands it must pay 0.50 USDC
2. Calls the ForgePay payment endpoint to submit the payment
3. Receives a `payment_token` as proof
4. Retries the original request with `x-payment-token: <token>` header
5. The server validates the token and returns the protected resource

ForgePay's stablecoin gateway (port 3002) handles the payment endpoint side.

---

## Package Overview

| Package | Purpose |
|---|---|
| `@forgepay/elizaos-plugin` | ElizaOS actions + context provider |
| `@forgepay/swarms-integration` | Swarms/OpenAI-compatible tool definitions |
| `@forgepay/claude-agents-cookbook` | End-to-end Claude agent examples |

---

## ElizaOS Plugin

The ElizaOS plugin adds two actions and one context provider to any
ElizaOS agent runtime.

### Installation

```bash
npm install @forgepay/elizaos-plugin
```

### Actions

**`PAY_WITH_FORGEPAY`**
Triggered when the agent detects payment intent (keywords: pay, 402, USDC,
send, transfer). Handles both direct USDC transfers and x402 auto-pay flows.

**`CHECK_FORGEPAY_BALANCE`**
Triggered when the agent is asked about balances, funds, or wallet status.
Returns live USDC/USDT balance and can answer sufficiency questions.

### Provider

**`forgePayProvider`**
Injects live account context into every agent turn — current balance,
merchant ID, supported chains, and x402 protocol capabilities. This means
the agent always knows its payment state without an explicit tool call.

### Usage

```typescript
import { createForgePayPlugin } from '@forgepay/elizaos-plugin';

const forgePayPlugin = createForgePayPlugin({
  apiKey: process.env.FORGEPAY_API_KEY,
  merchantId: process.env.FORGEPAY_MERCHANT_ID,
  // baseUrl: 'https://api.forgepay.io'  // optional
});

// Register with your ElizaOS agent
const agent = new AgentRuntime({
  plugins: [forgePayPlugin],
  character: myCharacter,
  // ...other config
});
```

### Example Interactions

```
User: Pay 5 USDC to access the weather data API
Agent: Initiating payment of 5 USDC...
       Payment of 5 USDC sent successfully!
       Transaction: 0xabc123...
       Confirmed in 1847ms via ForgePay on Base.

User: I got a 402 error when calling the data feed
Agent: Detected HTTP 402 x402 payment-required signal.
       Parsing payment headers and preparing USDC payment...
       x402 payment fulfilled! Amount: 0.50 USDC
       Transaction: 0xdef456...
       Retrying the original request now...

User: What's my balance?
Agent: ForgePay Wallet Balance:
         USDC: $250.00
         USDT: $100.00
         Total Stablecoin: $350.00
       Supported chains: Base, Ethereum, Polygon, Arbitrum
```

---

## Swarms Integration

The Swarms integration provides OpenAI function-calling compatible tool
definitions that work with the Swarms multi-agent framework and any other
framework that accepts the `tools` array format.

### Installation

```bash
npm install @forgepay/swarms-integration
```

### Available Tools

| Tool | Description |
|---|---|
| `forgepay_pay_usdc` | Send USDC/USDT to address or x402 endpoint |
| `forgepay_check_balance` | Get current USDC/USDT balance |
| `forgepay_get_payment_status` | Poll payment confirmation |
| `forgepay_create_invoice` | Create BTC/ETH/LTC/SOL/XMR invoice |
| `forgepay_list_transactions` | Paginated transaction history |
| `forgepay_parse_x402_headers` | Decode HTTP 402 payment headers |

### Usage with Swarms

```typescript
import { createForgePaySwarmToolkit } from '@forgepay/swarms-integration';

const toolkit = createForgePaySwarmToolkit({
  apiKey: process.env.FORGEPAY_API_KEY,
});

// Add tools to your Swarms agent
const agent = new Agent({
  tools: toolkit.tools,       // OpenAI-format tool definitions
  system_prompt: toolkit.systemPrompt + '\n\n' + yourSystemPrompt,
});

// In your tool dispatch loop:
const result = await toolkit.execute(toolCall.name, toolCall.arguments);
```

### Manual Tool Execution

```typescript
import { ForgePaySwarmsExecutor, FORGEPAY_TOOLS } from '@forgepay/swarms-integration';

const executor = new ForgePaySwarmsExecutor({
  apiKey: process.env.FORGEPAY_API_KEY,
});

// Execute a specific tool
const result = await executor.executeTool('forgepay_pay_usdc', {
  amount: 5.00,
  currency: 'USDC',
  chain: 'base',
  recipient_address: '0x1234...5678',
  description: 'API access payment',
});

if (result.success) {
  console.log('Paid:', result.data.txn_hash);
} else {
  console.error('Payment failed:', result.error);
}
```

### x402 Auto-Pay Pattern in Swarms

```typescript
// When an agent hits a 402, the model should call these tools in sequence:
// 1. forgepay_parse_x402_headers  → get payment details
// 2. forgepay_check_balance       → verify sufficient funds
// 3. forgepay_pay_usdc            → execute payment
// 4. <retry original request>     → with payment proof

const x402Info = await toolkit.execute('forgepay_parse_x402_headers', {
  headers: response.headers,
});

const balance = await toolkit.execute('forgepay_check_balance', {});

const payment = await toolkit.execute('forgepay_pay_usdc', {
  amount: x402Info.data.max_amount_required,
  currency: x402Info.data.asset,
  chain: x402Info.data.chain,
  payment_endpoint: x402Info.data.payment_endpoint,
});
```

---

## Claude Agents Examples

Three complete example agents are included. Each demonstrates a different
real-world agentic payment pattern.

### Prerequisites

```bash
cd forgepay/packages/claude-agents-cookbook
npm install

# Set environment variables
export ANTHROPIC_API_KEY=sk-ant-...
export FORGEPAY_API_KEY=fp_...
export FORGEPAY_MERCHANT_ID=merchant_...
```

All examples run in demo mode without live API keys — they simulate API
responses so you can see the full agentic workflow.

---

### Example 1: x402 Payment Agent

**File:** `examples/x402-payment-agent.ts`

Demonstrates an agent that autonomously handles HTTP 402 Payment Required
responses. The agent tries to access a premium data endpoint, hits a 402,
parses the x402 headers, pays with USDC via ForgePay, and retries.

**Tools defined:**
- `check_api_endpoint` — HTTP GET with 402 detection
- `check_forgepay_balance` — balance check before payment
- `pay_x402` — ForgePay stablecoin payment
- `retry_with_proof` — retry original request with payment token

**Run:**
```bash
npm run example:x402

# Or with custom endpoint:
PREMIUM_API_URL=https://your-api.com/v1/data npm run example:x402
```

**Expected output:**
```
=== ForgePay x402 Payment Agent ===
Target endpoint: https://data.example.io/v1/market/crypto
Starting agent loop...

--- Agent iteration 1 ---
Calling tool: check_api_endpoint
Result: {"status": 402, "x402Headers": {"maxAmountRequired": 0.5, "asset": "USDC", ...}}

--- Agent iteration 2 ---
Calling tool: check_forgepay_balance
Result: {"usdc": 250.00, "usdt": 100.00, "totalUsd": 350.00}

--- Agent iteration 3 ---
Calling tool: pay_x402
[TOOL] Demo payment — simulated txn hash: 0x3f7a8b2c...
Result: {"success": true, "txnHash": "0x3f7a...", "confirmationTimeMs": 1243}

--- Agent iteration 4 ---
Calling tool: retry_with_proof
Result: {"status": 200, "data": {"prices": {"BTC": {"usd": 67420.15}, ...}}}

=== Agent Final Response ===
Successfully accessed the premium crypto data API after paying 0.50 USDC.
...
```

---

### Example 2: Treasury Optimization Agent

**File:** `examples/treasury-agent.ts`

An enterprise treasury management agent that analyzes idle cash positions
and recommends (or executes) DeFi yield sweeps to optimize returns.

**Tools defined:**
- `get_cash_position` — full treasury snapshot
- `check_yield_rates` — live DeFi APY rates by protocol and chain
- `recommend_sweep` — optimal allocation recommendations
- `execute_sweep` — deploy idle funds to yield protocols

**Configuration via environment:**
```bash
SWEEP_THRESHOLD_USD=10000   # Min idle balance to recommend sweep
MAX_SWEEP_AMOUNT_USD=500000 # Max single transaction
AUTO_EXECUTE_SWEEPS=false   # true to auto-execute, false for recommendation only
```

**Run:**
```bash
npm run example:treasury

# Auto-execute mode:
AUTO_EXECUTE_SWEEPS=true npm run example:treasury
```

**Expected output:**
```
=== ForgePay Treasury Optimization Agent ===
Sweep threshold: $10,000
Auto-execute: false
Starting analysis...

--- Agent iteration 1 ---
Calling tool: get_cash_position
Result preview: {"total_idle_usd": 812250.00, "total_deployed_usd": 350000.00, ...}

--- Agent iteration 2 ---
Calling tool: check_yield_rates
Result preview: [{"protocol": "aave-v3", "chain": "base", "apy": 5.43, ...}]

--- Agent iteration 3 ---
Calling tool: recommend_sweep
Result preview: [{"from_account": "Operating Account - USDC (Base)", "to_protocol": ...}]

=== Treasury Agent Report ===
## Treasury Analysis

**Current Position:**
- Total Assets: $1,162,250
- Idle Cash: $812,250 (69.9% of total)
- Deployed Capital: $350,000 (30.1%)
- Current Weighted APY: 1.50%

**Optimization Opportunity:**
Deploying idle cash to Aave v3 (Base) at 5.43% APY would generate
an additional ~$44,105 in annual yield.

**Recommended Sweeps:**
1. Deploy $389,800 USDC from Operating Account (Base) → Aave v3 (Base)
   Expected APY: 5.43% | Annual yield: $21,176 | Risk: A

2. Deploy $100,000 USDC from Operating Account (Ethereum) → Aave v3 (Base)
   Expected APY: 5.43% | Annual yield: $5,430 | Risk: A
```

---

### Example 3: Marketplace Buyer Agent

**File:** `examples/marketplace-agent.ts`

A procurement agent that autonomously searches, evaluates, pays for, and
confirms delivery of API products from the ForgePay marketplace.

**Tools defined:**
- `search_marketplace` — find products by query
- `get_price_quote` — formal quote with x402 checkout headers
- `perform_due_diligence` — sample data, reviews, SLA terms
- `execute_payment` — ForgePay USDC checkout
- `confirm_delivery` — get access credentials after payment

**Configuration:**
```bash
BUDGET_USD=50              # Max purchase budget
MIN_VENDOR_SCORE=75        # Minimum reputation (0-100)
SEARCH_QUERY="gas oracle"  # What to buy
```

**Run:**
```bash
npm run example:marketplace

# Custom search:
SEARCH_QUERY="NFT floor price feed" BUDGET_USD=25 npm run example:marketplace
```

**Expected output:**
```
=== ForgePay Marketplace Buyer Agent ===
Search query: "real-time ETH gas price oracle"
Budget: $50 USD
Min vendor score: 75/100

--- Agent iteration 1 ---
Calling tool: search_marketplace
Result: [{"title": "Real-Time ETH Gas Price Oracle", "vendor_score": 91, "price_usd": 12.00}, ...]

--- Agent iteration 2 ---
Calling tool: perform_due_diligence
Result: {"passed": true, "sample_data": {"base_fee_gwei": "28.4", ...}, "recent_reviews": [...]}

--- Agent iteration 3 ---
Calling tool: get_price_quote
Result: {"final_price_usd": 12.00, "currency": "USDC", "quote_id": "q_...", ...}

--- Agent iteration 4 ---
Calling tool: execute_payment
[TOOL] Demo payment: 0x3f7a8b2c...
Result: {"txnHash": "0x3f7a...", "paymentToken": "pt_...", "confirmationTimeMs": 1891}

--- Agent iteration 5 ---
Calling tool: confirm_delivery
Result: {"access_key": "ak_9x3mw...", "api_endpoint": "https://api.gaswatch.io/v2", ...}

=== Purchase Complete ===
Successfully purchased "Real-Time ETH Gas Price Oracle" from GasWatch Labs.

Price paid: $12.00 USDC
Transaction: 0x3f7a8b2c...
Confirmed in 1891ms on Base

Access credentials:
  API Key: ak_9x3mw...
  Endpoint: https://api.gaswatch.io/v2

Value assessment: Excellent value — 1M API calls at $12 = $0.000012 per call.
The 4.7/5 rating and 234 reviews confirm reliability.
```

---

## Architecture

All three examples follow the same agentic loop pattern:

```
┌─────────────────────────────────────────────┐
│              Claude (claude-sonnet-4-5)      │
│                                             │
│  System prompt with payment guidelines      │
│  Tool definitions (check_api, pay, etc.)    │
└─────────────────┬───────────────────────────┘
                  │ tool_use
                  ▼
┌─────────────────────────────────────────────┐
│              Tool Dispatcher                │
│                                             │
│  dispatchTool(name, args) → JSON string     │
└──────┬──────────────────────────────────────┘
       │                        │
       ▼                        ▼
┌──────────────┐    ┌───────────────────────┐
│  External    │    │   ForgePay API        │
│  APIs        │    │   (api.forgepay.io)   │
│  (data,      │    │                       │
│   market)    │    │  /v1/x402/pay         │
└──────────────┘    │  /v1/accounts/balance │
                    │  /v1/treasury/*       │
                    └───────────────────────┘
```

The loop runs until `stop_reason === 'end_turn'` (no more tool calls needed)
or a maximum iteration count is reached.

---

## Common Patterns

### Pre-payment balance check

```typescript
// Always check balance before paying
const balance = await getBalance();
if (balance.usdc < requiredAmount) {
  throw new Error(`Insufficient USDC: have $${balance.usdc}, need $${requiredAmount}`);
}
```

### x402 retry logic

```typescript
let data = await fetchData(url);
if (data.status === 402 && data.x402Headers) {
  await pay(data.x402Headers);
  data = await fetchData(url, { paymentToken });
}
```

### Tool result as JSON string

Claude tool results must be strings. Serialize everything:
```typescript
toolResults.push({
  type: 'tool_result',
  tool_use_id: block.id,
  content: JSON.stringify(result, null, 2),  // must be string
});
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API key |
| `FORGEPAY_API_KEY` | — | ForgePay merchant API key |
| `FORGEPAY_BASE_URL` | `https://api.forgepay.io` | ForgePay API base URL |
| `FORGEPAY_MERCHANT_ID` | — | Your merchant ID |
| `PREMIUM_API_URL` | example endpoint | Target for x402 agent |
| `BUDGET_USD` | `50` | Max spend for marketplace agent |
| `MIN_VENDOR_SCORE` | `75` | Min vendor reputation |
| `SEARCH_QUERY` | gas oracle query | Marketplace search query |
| `SWEEP_THRESHOLD_USD` | `10000` | Min idle cash for treasury sweep |
| `MAX_SWEEP_AMOUNT_USD` | `500000` | Max single sweep |
| `AUTO_EXECUTE_SWEEPS` | `false` | Auto-execute treasury sweeps |

---

## Related Packages

- [`@forgepay/elizaos-plugin`](../elizaos-plugin/) — ElizaOS agent integration
- [`@forgepay/swarms-integration`](../swarms-integration/) — Swarms tools
- [`@forgepay/sdk-js`](../../packages/sdk-js/) — Core ForgePay TypeScript SDK
- [`@forgepay/forge-agent`](../../packages/forge-agent/) — Hermes-pattern agent loop
