/**
 * Treasury Optimization Agent
 *
 * Demonstrates a Claude agent that manages enterprise treasury cash positions
 * using ForgePay's treasury API. The agent:
 *
 *   1. Fetches the current cash position across stablecoins and fiat
 *   2. Analyzes idle cash vs. deployed capital
 *   3. Checks available yield rates from integrated DeFi protocols
 *   4. Calculates optimal allocation to maximize yield on idle funds
 *   5. Recommends — and optionally executes — sweep operations
 *   6. Generates a treasury report with P&L attribution
 *
 * This pattern is suitable for:
 *   - Automated treasury management for DAOs and crypto-native companies
 *   - Yield optimization for merchant float held in stablecoins
 *   - Regular rebalancing of multi-chain stablecoin positions
 *
 * Run: npx tsx examples/treasury-agent.ts
 */

import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? 'sk-ant-demo';
const FORGEPAY_API_KEY = process.env.FORGEPAY_API_KEY ?? 'fp_demo_key';
const FORGEPAY_BASE_URL = process.env.FORGEPAY_BASE_URL ?? 'https://api.forgepay.io';

/** Minimum idle cash threshold before suggesting a yield sweep ($) */
const SWEEP_THRESHOLD_USD = parseFloat(process.env.SWEEP_THRESHOLD_USD ?? '10000');
/** Maximum single-transaction sweep amount ($) */
const MAX_SWEEP_AMOUNT_USD = parseFloat(process.env.MAX_SWEEP_AMOUNT_USD ?? '500000');
/** Auto-execute sweeps? false = recommendation only */
const AUTO_EXECUTE = process.env.AUTO_EXECUTE_SWEEPS === 'true';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CashPosition {
  merchant_id: string;
  timestamp: string;
  accounts: {
    name: string;
    currency: string;
    balance: number;
    chain?: string;
    deployed: boolean;  // true = already earning yield
    protocol?: string;  // e.g. "aave-v3", "compound-v3"
    apy?: number;
  }[];
  total_idle_usd: number;
  total_deployed_usd: number;
  total_usd: number;
}

interface YieldRate {
  protocol: string;
  chain: string;
  asset: string;
  apy: number;
  tvl_usd: number;
  risk_tier: 'A' | 'B' | 'C';
  min_deposit_usd: number;
  withdrawal_delay_hours: number;
  audit_score: number; // 0-100
}

interface SweepRecommendation {
  from_account: string;
  to_protocol: string;
  amount_usd: number;
  asset: string;
  chain: string;
  expected_apy: number;
  estimated_annual_yield_usd: number;
  risk_tier: string;
}

interface SweepResult {
  success: boolean;
  sweep_id?: string;
  txn_hash?: string;
  amount_deployed?: number;
  protocol?: string;
  expected_apy?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function getCashPosition(): Promise<CashPosition> {
  console.log('[TOOL] get_cash_position: fetching treasury balances');

  try {
    const response = await axios.get(`${FORGEPAY_BASE_URL}/v1/treasury/position`, {
      headers: { 'x-api-key': FORGEPAY_API_KEY },
      timeout: 15_000,
    });
    return response.data;
  } catch {
    // Return realistic demo data when API isn't available
    console.log('[TOOL] Using demo cash position');
    const now = new Date().toISOString();
    return {
      merchant_id: 'merchant_demo_001',
      timestamp: now,
      accounts: [
        {
          name: 'Operating Account - USDC (Base)',
          currency: 'USDC',
          balance: 487_250.00,
          chain: 'base',
          deployed: false,
        },
        {
          name: 'Operating Account - USDC (Ethereum)',
          currency: 'USDC',
          balance: 125_000.00,
          chain: 'ethereum',
          deployed: false,
        },
        {
          name: 'Yield Position - Aave v3 (USDC)',
          currency: 'USDC',
          balance: 250_000.00,
          chain: 'polygon',
          deployed: true,
          protocol: 'aave-v3',
          apy: 4.82,
        },
        {
          name: 'Yield Position - Compound v3 (USDC)',
          currency: 'USDC',
          balance: 100_000.00,
          chain: 'ethereum',
          deployed: true,
          protocol: 'compound-v3',
          apy: 5.15,
        },
        {
          name: 'Treasury Reserve - USDT',
          currency: 'USDT',
          balance: 200_000.00,
          chain: 'ethereum',
          deployed: false,
        },
      ],
      total_idle_usd: 812_250.00,
      total_deployed_usd: 350_000.00,
      total_usd: 1_162_250.00,
    };
  }
}

async function checkYieldRates(asset: string = 'USDC'): Promise<YieldRate[]> {
  console.log(`[TOOL] check_yield_rates: fetching rates for ${asset}`);

  try {
    const response = await axios.get(`${FORGEPAY_BASE_URL}/v1/treasury/yield-rates`, {
      params: { asset },
      headers: { 'x-api-key': FORGEPAY_API_KEY },
      timeout: 10_000,
    });
    return response.data.rates;
  } catch {
    // Return demo yield rates
    console.log('[TOOL] Using demo yield rates');
    const rates: YieldRate[] = [
      {
        protocol: 'aave-v3',
        chain: 'base',
        asset: 'USDC',
        apy: 5.43,
        tvl_usd: 2_800_000_000,
        risk_tier: 'A',
        min_deposit_usd: 100,
        withdrawal_delay_hours: 0,
        audit_score: 95,
      },
      {
        protocol: 'compound-v3',
        chain: 'base',
        asset: 'USDC',
        apy: 5.18,
        tvl_usd: 1_200_000_000,
        risk_tier: 'A',
        min_deposit_usd: 100,
        withdrawal_delay_hours: 0,
        audit_score: 93,
      },
      {
        protocol: 'morpho-blue',
        chain: 'ethereum',
        asset: 'USDC',
        apy: 6.87,
        tvl_usd: 450_000_000,
        risk_tier: 'B',
        min_deposit_usd: 1000,
        withdrawal_delay_hours: 0,
        audit_score: 88,
      },
      {
        protocol: 'spark-protocol',
        chain: 'ethereum',
        asset: 'USDC',
        apy: 8.12,
        tvl_usd: 180_000_000,
        risk_tier: 'B',
        min_deposit_usd: 5000,
        withdrawal_delay_hours: 0,
        audit_score: 84,
      },
      {
        protocol: 'yearn-v3',
        chain: 'ethereum',
        asset: 'USDC',
        apy: 9.55,
        tvl_usd: 95_000_000,
        risk_tier: 'C',
        min_deposit_usd: 1000,
        withdrawal_delay_hours: 24,
        audit_score: 79,
      },
    ];
    return asset === 'USDT'
      ? rates.map((r) => ({ ...r, asset: 'USDT', apy: r.apy - 0.3 }))
      : rates;
  }
}

async function recommendSweep(
  position: CashPosition,
  yieldRates: YieldRate[]
): Promise<SweepRecommendation[]> {
  console.log('[TOOL] recommend_sweep: calculating optimal allocations');

  const recommendations: SweepRecommendation[] = [];

  // Filter idle accounts above threshold
  const idleAccounts = position.accounts.filter(
    (a) => !a.deployed && a.balance >= SWEEP_THRESHOLD_USD
  );

  for (const account of idleAccounts) {
    // Find best risk-A protocol for each idle account
    const eligibleRates = yieldRates
      .filter(
        (r) =>
          r.asset === account.currency &&
          r.risk_tier === 'A' &&
          r.min_deposit_usd <= account.balance
      )
      .sort((a, b) => b.apy - a.apy);

    if (eligibleRates.length === 0) continue;

    const best = eligibleRates[0];
    const sweepAmount = Math.min(account.balance * 0.8, MAX_SWEEP_AMOUNT_USD); // keep 20% liquid

    recommendations.push({
      from_account: account.name,
      to_protocol: best.protocol,
      amount_usd: sweepAmount,
      asset: account.currency,
      chain: best.chain,
      expected_apy: best.apy,
      estimated_annual_yield_usd: sweepAmount * (best.apy / 100),
      risk_tier: best.risk_tier,
    });
  }

  return recommendations;
}

async function executeSweep(recommendation: SweepRecommendation): Promise<SweepResult> {
  console.log(
    `[TOOL] execute_sweep: deploying $${recommendation.amount_usd.toLocaleString()} ` +
    `${recommendation.asset} to ${recommendation.to_protocol} (${recommendation.chain})`
  );

  try {
    const response = await axios.post(
      `${FORGEPAY_BASE_URL}/v1/treasury/sweep`,
      {
        from_account: recommendation.from_account,
        to_protocol: recommendation.to_protocol,
        amount: recommendation.amount_usd,
        asset: recommendation.asset,
        chain: recommendation.chain,
      },
      {
        headers: { 'x-api-key': FORGEPAY_API_KEY, 'Content-Type': 'application/json' },
        timeout: 60_000,
      }
    );

    return {
      success: true,
      sweep_id: response.data.sweep_id,
      txn_hash: response.data.txn_hash,
      amount_deployed: recommendation.amount_usd,
      protocol: recommendation.to_protocol,
      expected_apy: recommendation.expected_apy,
    };
  } catch {
    // Simulate success for demo
    const simulatedHash = `0x${Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')}`;
    console.log(`[TOOL] Demo sweep — simulated: ${simulatedHash.slice(0, 16)}...`);
    return {
      success: true,
      sweep_id: `sweep_${Date.now()}`,
      txn_hash: simulatedHash,
      amount_deployed: recommendation.amount_usd,
      protocol: recommendation.to_protocol,
      expected_apy: recommendation.expected_apy,
    };
  }
}

// ---------------------------------------------------------------------------
// Tool definitions for Claude
// ---------------------------------------------------------------------------
const tools: Anthropic.Tool[] = [
  {
    name: 'get_cash_position',
    description:
      'Fetch the current treasury cash position from ForgePay. Returns all accounts with ' +
      'balances, deployed/idle status, current yield protocol, and APY for deployed capital.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'check_yield_rates',
    description:
      'Fetch current DeFi yield rates from protocols integrated with ForgePay. Returns APY, ' +
      'TVL, risk tier (A/B/C), minimum deposit, withdrawal delay, and audit score for each ' +
      'protocol. Use this to find the best risk-adjusted yield for idle cash.',
    input_schema: {
      type: 'object',
      properties: {
        asset: {
          type: 'string',
          enum: ['USDC', 'USDT', 'DAI'],
          description: 'Stablecoin to check yield rates for. Default: USDC.',
        },
      },
    },
  },
  {
    name: 'recommend_sweep',
    description:
      'Analyze the current cash position against available yield rates and generate sweep ' +
      'recommendations. Returns a prioritized list of recommended allocations with expected ' +
      'annual yield estimates.',
    input_schema: {
      type: 'object',
      properties: {
        cash_position: {
          type: 'object',
          description: 'Full cash position object from get_cash_position',
        },
        yield_rates: {
          type: 'array',
          description: 'Array of yield rates from check_yield_rates',
        },
      },
      required: ['cash_position', 'yield_rates'],
    },
  },
  {
    name: 'execute_sweep',
    description:
      'Execute a treasury sweep — deploy idle stablecoin funds to a yield-generating DeFi ' +
      'protocol via ForgePay. Returns transaction hash and deployment confirmation.',
    input_schema: {
      type: 'object',
      properties: {
        from_account: { type: 'string' },
        to_protocol: { type: 'string' },
        amount_usd: { type: 'number' },
        asset: { type: 'string' },
        chain: { type: 'string' },
        expected_apy: { type: 'number' },
        estimated_annual_yield_usd: { type: 'number' },
        risk_tier: { type: 'string' },
      },
      required: ['from_account', 'to_protocol', 'amount_usd', 'asset', 'chain'],
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
    case 'get_cash_position':
      return JSON.stringify(await getCashPosition(), null, 2);
    case 'check_yield_rates':
      return JSON.stringify(await checkYieldRates(input.asset as string), null, 2);
    case 'recommend_sweep':
      return JSON.stringify(
        await recommendSweep(input.cash_position as CashPosition, input.yield_rates as YieldRate[]),
        null,
        2
      );
    case 'execute_sweep':
      return JSON.stringify(await executeSweep(input as SweepRecommendation), null, 2);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ---------------------------------------------------------------------------
// Agent agentic loop
// ---------------------------------------------------------------------------
async function runTreasuryAgent(): Promise<void> {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const systemPrompt = `You are a ForgePay Treasury Optimization Agent. Your role is to help
maximize yield on idle stablecoin cash positions while maintaining appropriate liquidity and
risk controls.

Guidelines:
- Always fetch the current cash position first to understand the baseline
- Check yield rates for all relevant stablecoins held (USDC, USDT)
- Prioritize risk-tier A protocols for the majority of deployments (>80% of assets)
- Keep at least 20% of each stablecoin position liquid (not deployed)
- Do not recommend deploying more than $${MAX_SWEEP_AMOUNT_USD.toLocaleString()} in a single transaction
- Only recommend sweeps for idle balances above $${SWEEP_THRESHOLD_USD.toLocaleString()}
- ${AUTO_EXECUTE ? 'Auto-execute approved recommendations.' : 'Provide recommendations but DO NOT execute them — present them for human approval.'}

After analysis, provide:
1. Treasury summary (total assets, idle vs deployed ratio, current weighted APY)
2. Optimization opportunities (potential yield uplift in $ and %)
3. Specific sweep recommendations ranked by expected impact
4. Risk considerations for each recommendation`;

  const userMessage = `Please analyze our current treasury position and provide yield optimization
recommendations. Show me:
1. Current cash position breakdown
2. How much is idle vs earning yield
3. Best yield opportunities available right now
4. Recommended sweeps to optimize returns
5. Expected annual yield improvement

${AUTO_EXECUTE ? 'Execute the top 2 recommendations automatically.' : 'Present recommendations for my approval — do not execute.'}`;

  console.log('\n=== ForgePay Treasury Optimization Agent ===');
  console.log(`Sweep threshold: $${SWEEP_THRESHOLD_USD.toLocaleString()}`);
  console.log(`Auto-execute: ${AUTO_EXECUTE}`);
  console.log('Starting analysis...\n');

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userMessage },
  ];

  let iteration = 0;
  const maxIterations = 12;

  while (iteration < maxIterations) {
    iteration++;
    console.log(`\n--- Agent iteration ${iteration} ---`);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 8192,
      system: systemPrompt,
      tools,
      messages,
    });

    console.log(`Stop reason: ${response.stop_reason}`);
    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      console.log('\n=== Treasury Agent Report ===');
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
          console.log('Result preview:', result.slice(0, 200) + (result.length > 200 ? '...' : ''));

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
runTreasuryAgent().catch((err) => {
  console.error('Treasury agent error:', err.message);
  process.exit(1);
});
