export { FORGEPAY_TOOLS, getToolByName, getToolSummary } from './tools';
export type { ToolDefinition } from './tools';
export { ForgePaySwarmsExecutor } from './executor';
export type { ForgePaySwarmsConfig, ToolExecutionResult } from './executor';

/**
 * ForgePay Swarms Toolkit
 *
 * A batteries-included toolkit for integrating ForgePay into any Swarms
 * multi-agent workflow or OpenAI-compatible tool-use pipeline.
 *
 * @example
 * ```typescript
 * import { createForgePaySwarmToolkit } from '@forgepay/swarms-integration';
 *
 * const toolkit = createForgePaySwarmToolkit({ apiKey: process.env.FORGEPAY_API_KEY! });
 *
 * // Add toolkit.tools to your agent's tools list
 * // Call toolkit.execute(toolName, args) inside your tool dispatch loop
 * // Prepend toolkit.systemPrompt to your agent's system message
 * ```
 */
export function createForgePaySwarmToolkit(config: {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
}) {
  const { ForgePaySwarmsExecutor } = require('./executor');
  const { FORGEPAY_TOOLS } = require('./tools');
  const executor = new ForgePaySwarmsExecutor(config);

  /**
   * Execute a named ForgePay tool with the provided arguments.
   * Wraps executor.executeTool for convenience.
   */
  const execute = async (
    toolName: string,
    args: Record<string, any>
  ) => executor.executeTool(toolName, args);

  const systemPrompt =
    `You have access to ForgePay payment tools that allow you to make autonomous crypto payments.\n\n` +
    `Available tools:\n` +
    `  - forgepay_pay_usdc: Send USDC/USDT payments to addresses or x402 endpoints\n` +
    `  - forgepay_check_balance: Check available USDC/USDT balance\n` +
    `  - forgepay_create_invoice: Create BTC/ETH/LTC/SOL/XMR payment invoices\n` +
    `  - forgepay_get_payment_status: Poll payment confirmation status\n` +
    `  - forgepay_list_transactions: View transaction history\n` +
    `  - forgepay_parse_x402_headers: Decode HTTP 402 payment-required headers\n\n` +
    `x402 Protocol:\n` +
    `  When you encounter an HTTP 402 response, the service requires a micropayment.\n` +
    `  Workflow:\n` +
    `    1. Call forgepay_parse_x402_headers with the response headers\n` +
    `    2. Call forgepay_check_balance to confirm sufficient funds\n` +
    `    3. Call forgepay_pay_usdc with the payment details\n` +
    `    4. Retry the original request — the payment proof is submitted automatically\n\n` +
    `Always check balance before large payments. Payments on Base settle in ~2 seconds.`;

  return {
    tools: FORGEPAY_TOOLS,
    execute,
    systemPrompt,
    /** Raw executor for advanced use-cases */
    executor,
  };
}
