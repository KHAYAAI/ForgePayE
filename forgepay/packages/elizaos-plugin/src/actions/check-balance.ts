import { ForgePayClient } from '../client';
import {
  ElizaAction,
  ElizaCallback,
  ElizaMessage,
  ElizaRuntime,
  ElizaState,
  ForgePayConfig,
} from '../types';

/**
 * ElizaOS action: check the ForgePay USDC and USDT wallet balance.
 *
 * Trigger phrases: "balance", "how much USDC", "check funds", "wallet", "funds available"
 */
export function createCheckBalanceAction(config: ForgePayConfig): ElizaAction {
  const client = new ForgePayClient(config);

  return {
    name: 'CHECK_FORGEPAY_BALANCE',
    description:
      'Check the current USDC and USDT balance in the ForgePay account. Use this when the ' +
      'agent needs to know if there are sufficient funds before making a payment, or when the ' +
      'user asks about available balance, wallet funds, or stablecoin holdings.',
    examples: [
      [
        'What is my USDC balance?',
        'Your ForgePay balance: USDC $250.00 | USDT $100.00',
      ],
      [
        'Do I have enough funds to pay $50?',
        'Your ForgePay balance is $250.00 USDC — sufficient for a $50 payment.',
      ],
      [
        'Check my wallet balance',
        'ForgePay wallet: USDC $250.00, USDT $100.00',
      ],
      [
        'How much crypto do I have available?',
        'Available stablecoin balance: USDC $250.00 | USDT $100.00',
      ],
    ],

    validate: async (_runtime: ElizaRuntime, message: ElizaMessage): Promise<boolean> => {
      const text = (message?.content?.text ?? '').toLowerCase();
      return (
        text.includes('balance') ||
        text.includes('funds') ||
        text.includes('wallet') ||
        text.includes('how much') ||
        text.includes('enough') ||
        (text.includes('usdc') && text.includes('check')) ||
        (text.includes('usdt') && text.includes('check'))
      );
    },

    handler: async (
      _runtime: ElizaRuntime,
      message: ElizaMessage,
      _state: ElizaState,
      _options: Record<string, any>,
      callback: ElizaCallback
    ): Promise<void> => {
      const text = message?.content?.text ?? '';

      callback({
        text: 'Fetching your ForgePay balance...',
        action: 'CHECK_FORGEPAY_BALANCE',
      });

      const balance = await client.getBalance();
      const totalUSD = balance.usdc + balance.usdt;

      // Check if user is asking about sufficiency for a specific amount
      const amountMatch = text.match(/\$?\s*(\d+(?:\.\d+)?)/);
      if (amountMatch && (text.toLowerCase().includes('enough') || text.toLowerCase().includes('afford'))) {
        const needed = parseFloat(amountMatch[1]);
        const sufficient = balance.usdc >= needed;
        callback({
          text:
            `ForgePay Balance:\n` +
            `  USDC: $${balance.usdc.toFixed(2)}\n` +
            `  USDT: $${balance.usdt.toFixed(2)}\n` +
            `  Total: $${totalUSD.toFixed(2)}\n\n` +
            (sufficient
              ? `Yes, you have sufficient funds for a $${needed.toFixed(2)} payment.`
              : `Insufficient funds — you need $${needed.toFixed(2)} but only have $${balance.usdc.toFixed(2)} USDC.`),
          action: 'CHECK_FORGEPAY_BALANCE',
        });
        return;
      }

      // Default balance report
      callback({
        text:
          `ForgePay Wallet Balance:\n` +
          `  USDC: $${balance.usdc.toFixed(2)}\n` +
          `  USDT: $${balance.usdt.toFixed(2)}\n` +
          `  Total Stablecoin: $${totalUSD.toFixed(2)}\n\n` +
          `Merchant ID: ${config.merchantId}\n` +
          `Supported chains: Base, Ethereum, Polygon, Arbitrum`,
        action: 'CHECK_FORGEPAY_BALANCE',
      });
    },
  };
}
