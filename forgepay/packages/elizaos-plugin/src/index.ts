import { ForgePayConfig, ElizaPlugin } from './types';
import { createPayAction } from './actions/pay';
import { createCheckBalanceAction } from './actions/check-balance';
import { createForgePayProvider } from './providers/forgepay-context';

// Re-export the client for consumers who want direct API access
export { ForgePayClient } from './client';

// Re-export all types
export type {
  ForgePayConfig,
  PaymentRequest,
  PaymentResult,
  X402PaymentHeader,
  BalanceResult,
  ElizaAction,
  ElizaProvider,
  ElizaPlugin,
  ElizaMessage,
  ElizaRuntime,
  ElizaState,
  ElizaCallback,
} from './types';

/**
 * Create a fully configured ForgePay ElizaOS plugin.
 *
 * @param config - API key, merchant ID, and optional base URL
 * @returns An ElizaOS-compatible plugin object with actions and providers
 *
 * @example
 * ```typescript
 * import { createForgePayPlugin } from '@forgepay/elizaos-plugin';
 *
 * const forgePayPlugin = createForgePayPlugin({
 *   apiKey: process.env.FORGEPAY_API_KEY!,
 *   merchantId: process.env.FORGEPAY_MERCHANT_ID!,
 * });
 *
 * // Register with your ElizaOS agent runtime
 * const agent = new AgentRuntime({
 *   plugins: [forgePayPlugin],
 *   // ...other config
 * });
 * ```
 */
export function createForgePayPlugin(config: ForgePayConfig): ElizaPlugin {
  return {
    name: '@forgepay/elizaos-plugin',
    description:
      'ForgePay payment plugin — enables ElizaOS agents to make USDC payments, handle x402 ' +
      'HTTP 402 responses autonomously, and manage stablecoin balances across Base, Ethereum, ' +
      'Polygon, and Arbitrum.',
    actions: [
      createPayAction(config),
      createCheckBalanceAction(config),
    ],
    providers: [
      createForgePayProvider(config),
    ],
  };
}

export default createForgePayPlugin;
