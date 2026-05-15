/**
 * ForgePay tool definitions in OpenAI function-calling format.
 *
 * These are compatible with:
 *   - Swarms framework (swarms-corp/swarms)
 *   - Any OpenAI-compatible tool_use workflow
 *   - LangChain structured tools
 *   - AutoGen function maps
 *
 * Import FORGEPAY_TOOLS and pass them directly to your agent's tools list.
 */

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: string;
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export const FORGEPAY_TOOLS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'forgepay_pay_usdc',
      description:
        'Send a USDC or USDT payment to a recipient address or API payment endpoint using ForgePay. ' +
        'Use this tool when you encounter an HTTP 402 response with x402 headers to fulfil the ' +
        'payment automatically, or to send direct stablecoin transfers. Settlement takes ~2 seconds ' +
        'on Base L2. Always check balance first with forgepay_check_balance.',
      parameters: {
        type: 'object',
        properties: {
          amount: {
            type: 'number',
            description: 'Payment amount in USD-equivalent (e.g. 5.00 for $5 USDC)',
          },
          currency: {
            type: 'string',
            enum: ['USDC', 'USDT'],
            default: 'USDC',
            description: 'Stablecoin to use for payment. Default: USDC.',
          },
          recipient_address: {
            type: 'string',
            description:
              'Ethereum-compatible wallet address of the recipient (0x...). ' +
              'Optional for x402 flows where the payment endpoint is known.',
          },
          payment_endpoint: {
            type: 'string',
            description:
              'x402 payment endpoint URL from x-402-payment-endpoint header. ' +
              'Use this instead of recipient_address for HTTP 402 auto-pay flows.',
          },
          chain: {
            type: 'string',
            enum: ['base', 'ethereum', 'polygon', 'arbitrum'],
            default: 'base',
            description: 'Target blockchain. Base is fastest and cheapest (~2s, <$0.01 gas).',
          },
          description: {
            type: 'string',
            description: 'Human-readable description of the payment purpose for audit trail.',
          },
        },
        required: ['amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forgepay_check_balance',
      description:
        'Check the current available USDC and USDT balance in the ForgePay merchant account. ' +
        'Call this before making payments to verify sufficient funds are available. ' +
        'Returns real-time balance data.',
      parameters: {
        type: 'object',
        properties: {
          currency: {
            type: 'string',
            enum: ['USDC', 'USDT', 'all'],
            default: 'all',
            description: 'Which currency balance to return. Default: all.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forgepay_get_payment_status',
      description:
        'Get the current status of a ForgePay payment by its transaction hash or internal payment ID. ' +
        'Returns confirmation count, block number, and finality status. ' +
        'A payment is final after 1 confirmation on Base (typically 2 seconds).',
      parameters: {
        type: 'object',
        properties: {
          payment_id: {
            type: 'string',
            description:
              'The payment identifier — either a 0x-prefixed transaction hash or a ForgePay ' +
              'internal payment UUID returned by forgepay_pay_usdc.',
          },
        },
        required: ['payment_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forgepay_create_invoice',
      description:
        'Create a crypto payment invoice for BTC, ETH, LTC, SOL, or XMR. The invoice includes ' +
        'a deposit address and expires after 15 minutes. Returns a payment URL and QR code data. ' +
        'Use for receiving crypto payments from counterparties.',
      parameters: {
        type: 'object',
        properties: {
          amount_usd: {
            type: 'number',
            description: 'Invoice amount in USD. Will be converted to the equivalent crypto amount.',
          },
          coin: {
            type: 'string',
            enum: ['BTC', 'ETH', 'LTC', 'SOL', 'XMR'],
            description: 'Cryptocurrency the payer should send.',
          },
          description: {
            type: 'string',
            description: 'Invoice description shown to the payer.',
          },
          expiry_minutes: {
            type: 'number',
            default: 15,
            description: 'Invoice validity window in minutes. Default: 15.',
          },
          callback_url: {
            type: 'string',
            description: 'Webhook URL to notify when payment is confirmed.',
          },
        },
        required: ['amount_usd', 'coin'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forgepay_list_transactions',
      description:
        'List recent payment transactions for the ForgePay account. Useful for auditing, ' +
        'reconciliation, or checking payment history. Returns paginated results.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            default: 10,
            description: 'Maximum number of transactions to return (1-100). Default: 10.',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor from previous response to fetch the next page.',
          },
          direction: {
            type: 'string',
            enum: ['inbound', 'outbound', 'all'],
            default: 'all',
            description: 'Filter by payment direction.',
          },
          currency: {
            type: 'string',
            enum: ['USDC', 'USDT', 'BTC', 'ETH', 'all'],
            default: 'all',
            description: 'Filter by currency.',
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'forgepay_parse_x402_headers',
      description:
        'Parse HTTP response headers from a 402 Payment Required response to extract x402 ' +
        'payment details. Returns structured payment info including the required amount, asset, ' +
        'chain, and payment endpoint. Call this when you receive an HTTP 402 response before ' +
        'calling forgepay_pay_usdc.',
      parameters: {
        type: 'object',
        properties: {
          headers: {
            type: 'object',
            description:
              'Key-value map of HTTP response headers from the 402 response. ' +
              'Must include x-402-version, x-402-max-amount, x-402-payment-endpoint.',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['headers'],
      },
    },
  },
];

/**
 * Get a single tool definition by name.
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return FORGEPAY_TOOLS.find((t) => t.function.name === name);
}

/**
 * Get tool definitions as a simple name -> description map.
 * Useful for building system prompt summaries.
 */
export function getToolSummary(): Record<string, string> {
  return Object.fromEntries(
    FORGEPAY_TOOLS.map((t) => [t.function.name, t.function.description.split('\n')[0]])
  );
}
