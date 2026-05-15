import axios, { AxiosInstance } from 'axios';

export interface ForgePaySwarmsConfig {
  apiKey: string;
  baseUrl?: string;
  /** Optional timeout override in ms. Default: 30_000 */
  timeoutMs?: number;
}

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  toolName: string;
  executionTimeMs: number;
}

/**
 * Executor for ForgePay Swarms tools.
 *
 * Implements the tool functions declared in tools.ts. Designed to slot
 * directly into a Swarms agent's tool_executor callback.
 *
 * @example
 * ```typescript
 * const executor = new ForgePaySwarmsExecutor({ apiKey: '...' });
 *
 * // Inside a Swarms agent tool loop:
 * const result = await executor.executeTool(toolCall.function.name, toolCall.function.arguments);
 * ```
 */
export class ForgePaySwarmsExecutor {
  private config: ForgePaySwarmsConfig;
  private baseUrl: string;
  private http: AxiosInstance;

  constructor(config: ForgePaySwarmsConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.forgepay.io';
    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'x-api-key': this.config.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: config.timeoutMs ?? 30_000,
    });
  }

  /**
   * Route a Swarms tool call to the correct ForgePay API endpoint.
   *
   * @param toolName  - Function name matching one of the FORGEPAY_TOOLS definitions
   * @param args      - Parsed JSON arguments from the model's tool_call
   * @returns         - ToolExecutionResult with data or error
   */
  async executeTool(
    toolName: string,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    const start = Date.now();

    try {
      const data = await this.dispatch(toolName, args);
      return {
        success: true,
        data,
        toolName,
        executionTimeMs: Date.now() - start,
      };
    } catch (error: any) {
      const message =
        error?.response?.data?.error ??
        error?.response?.data?.message ??
        error?.message ??
        'Unknown error';
      return {
        success: false,
        error: message,
        toolName,
        executionTimeMs: Date.now() - start,
      };
    }
  }

  private async dispatch(toolName: string, args: Record<string, any>): Promise<any> {
    switch (toolName) {
      case 'forgepay_pay_usdc':
        return this.payUsdc(args);

      case 'forgepay_check_balance':
        return this.checkBalance(args);

      case 'forgepay_get_payment_status':
        return this.getPaymentStatus(args);

      case 'forgepay_create_invoice':
        return this.createInvoice(args);

      case 'forgepay_list_transactions':
        return this.listTransactions(args);

      case 'forgepay_parse_x402_headers':
        return this.parseX402Headers(args);

      default:
        throw new Error(`Unknown ForgePay tool: ${toolName}`);
    }
  }

  private async payUsdc(args: Record<string, any>): Promise<any> {
    const payload: Record<string, any> = {
      amount: args.amount,
      currency: args.currency ?? 'USDC',
      chain: args.chain ?? 'base',
    };
    if (args.recipient_address) payload.recipient = args.recipient_address;
    if (args.payment_endpoint) payload.payment_endpoint = args.payment_endpoint;
    if (args.description) payload.description = args.description;

    const response = await this.http.post('/v1/x402/pay', payload);
    return {
      txn_hash: response.data.txn_hash,
      amount: args.amount,
      currency: args.currency ?? 'USDC',
      chain: args.chain ?? 'base',
      status: 'confirmed',
      explorer_url: `https://basescan.org/tx/${response.data.txn_hash}`,
    };
  }

  private async checkBalance(args: Record<string, any>): Promise<any> {
    const response = await this.http.get('/v1/accounts/balance', { timeout: 10_000 });
    const { usdc = 0, usdt = 0 } = response.data;

    const currency = args.currency ?? 'all';
    if (currency === 'USDC') return { USDC: usdc };
    if (currency === 'USDT') return { USDT: usdt };
    return { USDC: usdc, USDT: usdt, total_usd: usdc + usdt };
  }

  private async getPaymentStatus(args: Record<string, any>): Promise<any> {
    const response = await this.http.get(`/v1/payments/${args.payment_id}`, {
      timeout: 10_000,
    });
    return {
      payment_id: args.payment_id,
      status: response.data.status,
      confirmations: response.data.confirmations ?? 0,
      block_number: response.data.block_number,
      amount: response.data.amount,
      currency: response.data.currency,
      finalized: (response.data.confirmations ?? 0) >= 1,
    };
  }

  private async createInvoice(args: Record<string, any>): Promise<any> {
    const payload = {
      amount_usd: args.amount_usd,
      coin: args.coin,
      description: args.description,
      expiry_minutes: args.expiry_minutes ?? 15,
      callback_url: args.callback_url,
    };
    const response = await this.http.post('/v1/invoices', payload, { timeout: 10_000 });
    return {
      invoice_id: response.data.invoice_id,
      payment_url: response.data.payment_url,
      deposit_address: response.data.deposit_address,
      amount_crypto: response.data.amount_crypto,
      coin: args.coin,
      amount_usd: args.amount_usd,
      expires_at: response.data.expires_at,
      qr_code_data: response.data.qr_code_data,
    };
  }

  private async listTransactions(args: Record<string, any>): Promise<any> {
    const params: Record<string, any> = {
      limit: args.limit ?? 10,
      direction: args.direction ?? 'all',
      currency: args.currency ?? 'all',
    };
    if (args.cursor) params.cursor = args.cursor;

    const response = await this.http.get('/v1/transactions', {
      params,
      timeout: 10_000,
    });
    return {
      transactions: response.data.transactions ?? [],
      next_cursor: response.data.next_cursor,
      total: response.data.total,
    };
  }

  private parseX402Headers(args: Record<string, any>): any {
    const headers: Record<string, string> = args.headers ?? {};
    if (!headers['x-402-version']) {
      return { is_x402: false, reason: 'x-402-version header not present' };
    }
    return {
      is_x402: true,
      version: headers['x-402-version'],
      scheme: headers['x-402-scheme'] ?? 'x402',
      max_amount_required: parseFloat(headers['x-402-max-amount'] ?? '0'),
      asset: headers['x-402-asset'] ?? 'USDC',
      payment_endpoint: headers['x-402-payment-endpoint'],
      chain: headers['x-402-chain'] ?? 'base',
      recommended_action:
        `Call forgepay_pay_usdc with amount=${headers['x-402-max-amount']}, ` +
        `currency=${headers['x-402-asset'] ?? 'USDC'}, chain=${headers['x-402-chain'] ?? 'base'}, ` +
        `payment_endpoint="${headers['x-402-payment-endpoint']}"`,
    };
  }
}
