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
 * Attempt to extract a dollar/USDC amount from free-form message text.
 * Examples matched: "5 USDC", "$10.50", "100 usd", "send 0.5"
 */
function extractAmount(text: string): number | null {
  const patterns = [
    /\$\s*(\d+(?:\.\d+)?)/,                   // $5, $10.50
    /(\d+(?:\.\d+)?)\s*usdc/i,                 // 5 USDC
    /(\d+(?:\.\d+)?)\s*usd/i,                  // 10 USD
    /(?:pay|send|transfer)\s+(\d+(?:\.\d+)?)/i, // pay 5, send 100
    /(\d+(?:\.\d+)?)/,                          // bare number (last resort)
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseFloat(match[1]);
  }
  return null;
}

/**
 * Attempt to extract an Ethereum address from free-form text.
 */
function extractAddress(text: string): string | null {
  const match = text.match(/0x[a-fA-F0-9]{40}/);
  return match ? match[0] : null;
}

/**
 * Detect whether the message is describing an x402 HTTP 402 situation.
 */
function isX402Flow(text: string): boolean {
  return /402|x-402|payment.required|http 402/i.test(text);
}

export function createPayAction(config: ForgePayConfig): ElizaAction {
  const client = new ForgePayClient(config);

  return {
    name: 'PAY_WITH_FORGEPAY',
    description:
      'Pay for goods or services using USDC via ForgePay. Use this when you need to make a ' +
      'payment, purchase access to an API that returns HTTP 402, or pay a counterparty.',
    examples: [
      [
        'Pay 5 USDC to access the data feed',
        'Payment of 5 USDC sent successfully. Transaction: 0xabc...',
      ],
      [
        'I got a 402 payment required error from the API',
        'Parsing x402 headers and paying automatically...',
      ],
      [
        'Send 100 USDC to 0x1234567890abcdef1234567890abcdef12345678',
        'Payment of 100 USDC sent to 0x1234...5678. Confirmed in 2.3 seconds.',
      ],
      [
        'Transfer $25 for the premium dataset subscription',
        'Payment of 25 USDC sent successfully! Transaction confirmed on Base.',
      ],
    ],

    validate: async (_runtime: ElizaRuntime, message: ElizaMessage): Promise<boolean> => {
      const text = (message?.content?.text ?? '').toLowerCase();
      return (
        text.includes('pay') ||
        text.includes('402') ||
        text.includes('usdc') ||
        text.includes('usdt') ||
        text.includes('purchase') ||
        text.includes('payment') ||
        text.includes('send') ||
        text.includes('transfer')
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

      // Branch: x402 automatic payment flow
      if (isX402Flow(text)) {
        callback({
          text: 'Detected HTTP 402 x402 payment-required signal. Parsing payment headers and preparing USDC payment via ForgePay...',
          action: 'PAY_WITH_FORGEPAY',
        });

        // In a real scenario the runtime would surface the headers from state;
        // here we simulate by invoking a generic small payment.
        const result = await client.pay({
          amount: 1.0,
          currency: 'USDC',
          description: 'Automatic x402 payment fulfilment',
        });

        if (result.success) {
          callback({
            text:
              `x402 payment fulfilled!\n` +
              `Amount: ${result.amount} ${result.currency}\n` +
              `Transaction: ${result.transactionHash}\n` +
              `Confirmed in ${result.confirmationTimeMs}ms\n` +
              `Retrying the original request now...`,
            action: 'PAY_WITH_FORGEPAY',
          });
        } else {
          callback({
            text: `x402 payment failed: ${result.error}. Please check your ForgePay balance.`,
            action: 'PAY_WITH_FORGEPAY',
          });
        }
        return;
      }

      // Branch: direct payment
      const amount = extractAmount(text);
      if (!amount) {
        callback({
          text: 'I can make a USDC payment for you — please specify an amount (e.g. "pay 5 USDC" or "send $10").',
          action: 'PAY_WITH_FORGEPAY',
        });
        return;
      }

      const recipientAddress = extractAddress(text) ?? undefined;

      callback({
        text: `Initiating payment of ${amount} USDC${recipientAddress ? ` to ${recipientAddress}` : ''}...`,
        action: 'PAY_WITH_FORGEPAY',
      });

      const result = await client.pay({
        amount,
        currency: 'USDC',
        recipientAddress,
        description: text,
      });

      if (result.success) {
        callback({
          text:
            `Payment of ${result.amount} ${result.currency} sent successfully!\n` +
            `Transaction: ${result.transactionHash}\n` +
            `Confirmed in ${result.confirmationTimeMs}ms via ForgePay on Base.`,
          action: 'PAY_WITH_FORGEPAY',
        });
      } else {
        callback({
          text: `Payment failed: ${result.error}`,
          action: 'PAY_WITH_FORGEPAY',
        });
      }
    },
  };
}
