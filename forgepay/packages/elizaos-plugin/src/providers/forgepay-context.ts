import { ForgePayClient } from '../client';
import {
  ElizaMessage,
  ElizaProvider,
  ElizaRuntime,
  ElizaState,
  ForgePayConfig,
} from '../types';

/**
 * ElizaOS context provider: injects live ForgePay account state into every
 * agent turn so the model always knows the current balance and configuration
 * without needing to ask.
 *
 * The string returned here is injected as system-level context before the
 * agent generates its response.
 */
export function createForgePayProvider(config: ForgePayConfig): ElizaProvider {
  const client = new ForgePayClient(config);

  return {
    get: async (
      _runtime: ElizaRuntime,
      _message: ElizaMessage,
      _state: ElizaState
    ): Promise<string> => {
      // Fetch live balance — gracefully handles network failures
      const balance = await client.getBalance();
      const totalUSD = balance.usdc + balance.usdt;
      const now = new Date().toISOString();

      return (
        `=== ForgePay Account Context (as of ${now}) ===\n` +
        `Merchant ID   : ${config.merchantId}\n` +
        `API Endpoint  : ${config.baseUrl ?? 'https://api.forgepay.io'}\n` +
        `\n` +
        `Wallet Balances:\n` +
        `  USDC          : $${balance.usdc.toFixed(2)}\n` +
        `  USDT          : $${balance.usdt.toFixed(2)}\n` +
        `  Total         : $${totalUSD.toFixed(2)}\n` +
        `\n` +
        `Payment Protocol:\n` +
        `  Protocol      : x402 (HTTP 402 Payment Required)\n` +
        `  Supported assets : USDC, USDT\n` +
        `  Supported chains : Base (default), Ethereum, Polygon, Arbitrum\n` +
        `  Settlement    : ~2 seconds on Base L2\n` +
        `\n` +
        `Capabilities:\n` +
        `  - Autonomous x402 payment fulfilment (HTTP 402 auto-pay)\n` +
        `  - Direct USDC/USDT transfers to any Ethereum-compatible address\n` +
        `  - Real-time balance monitoring\n` +
        `  - Payment status tracking by transaction hash\n` +
        `\n` +
        `Instructions:\n` +
        `  When you encounter an HTTP 402 response with x402 headers, use the\n` +
        `  PAY_WITH_FORGEPAY action to automatically fulfil the payment and\n` +
        `  retry the original request. Always check balance before large payments.\n` +
        `=== End ForgePay Context ===`
      );
    },
  };
}
