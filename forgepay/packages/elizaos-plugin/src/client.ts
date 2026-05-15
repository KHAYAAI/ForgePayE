import axios from 'axios';
import {
  ForgePayConfig,
  PaymentRequest,
  PaymentResult,
  X402PaymentHeader,
  BalanceResult,
} from './types';

export class ForgePayClient {
  private config: ForgePayConfig;
  private baseUrl: string;

  constructor(config: ForgePayConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.forgepay.io';
  }

  private get authHeaders(): Record<string, string> {
    return {
      'x-api-key': this.config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Parse x402 payment-required HTTP response headers into a structured object.
   * Returns null if the headers don't contain x402 fields.
   */
  async parseX402Headers(
    headers: Record<string, string>
  ): Promise<X402PaymentHeader | null> {
    if (!headers['x-402-version']) return null;
    return {
      version: headers['x-402-version'],
      scheme: headers['x-402-scheme'] ?? 'x402',
      maxAmountRequired: headers['x-402-max-amount'],
      asset: headers['x-402-asset'] ?? 'USDC',
      paymentEndpoint: headers['x-402-payment-endpoint'],
      chain: headers['x-402-chain'] ?? 'base',
    };
  }

  /**
   * Fulfil an x402 payment-required challenge automatically.
   * Parses the payment info and calls the ForgePay stablecoin gateway.
   */
  async payX402(paymentInfo: X402PaymentHeader): Promise<PaymentResult> {
    const start = Date.now();
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/x402/pay`,
        {
          amount: parseFloat(paymentInfo.maxAmountRequired),
          currency: paymentInfo.asset,
          chain: paymentInfo.chain,
          payment_endpoint: paymentInfo.paymentEndpoint,
        },
        { headers: this.authHeaders, timeout: 30_000 }
      );

      return {
        success: true,
        transactionHash: response.data.txn_hash,
        amount: parseFloat(paymentInfo.maxAmountRequired),
        currency: paymentInfo.asset,
        confirmationTimeMs: Date.now() - start,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.response?.data?.error ?? error.message,
      };
    }
  }

  /**
   * Send a direct USDC/USDT payment by amount and optional recipient.
   */
  async pay(request: PaymentRequest): Promise<PaymentResult> {
    const start = Date.now();
    try {
      const response = await axios.post(
        `${this.baseUrl}/v1/x402/pay`,
        {
          amount: request.amount,
          currency: request.currency ?? 'USDC',
          recipient: request.recipientAddress,
          description: request.description,
        },
        { headers: this.authHeaders, timeout: 30_000 }
      );

      return {
        success: true,
        transactionHash: response.data.txn_hash,
        amount: request.amount,
        currency: request.currency ?? 'USDC',
        confirmationTimeMs: Date.now() - start,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error?.response?.data?.error ?? error.message,
      };
    }
  }

  /**
   * Fetch the current USDC and USDT balances for the configured merchant.
   */
  async getBalance(): Promise<BalanceResult> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/accounts/balance`,
        { headers: this.authHeaders, timeout: 10_000 }
      );
      return {
        usdc: response.data.usdc ?? 0,
        usdt: response.data.usdt ?? 0,
      };
    } catch {
      return { usdc: 0, usdt: 0 };
    }
  }

  /**
   * Fetch the status of a specific payment by its transaction hash or internal ID.
   */
  async getPaymentStatus(
    paymentId: string
  ): Promise<{ status: string; confirmations?: number; error?: string }> {
    try {
      const response = await axios.get(
        `${this.baseUrl}/v1/payments/${paymentId}`,
        { headers: this.authHeaders, timeout: 10_000 }
      );
      return { status: response.data.status, confirmations: response.data.confirmations };
    } catch (error: any) {
      return { status: 'unknown', error: error?.response?.data?.error ?? error.message };
    }
  }
}
