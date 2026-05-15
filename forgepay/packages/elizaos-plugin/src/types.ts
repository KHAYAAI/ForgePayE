export interface ForgePayConfig {
  apiKey: string;
  baseUrl?: string;   // default: https://api.forgepay.io
  merchantId: string;
}

export interface PaymentRequest {
  amount: number;       // USD
  currency?: string;    // default: USDC
  recipientAddress?: string;
  description?: string;
}

export interface PaymentResult {
  success: boolean;
  transactionHash?: string;
  amount?: number;
  currency?: string;
  confirmationTimeMs?: number;
  error?: string;
}

export interface X402PaymentHeader {
  version: string;
  scheme: string;
  maxAmountRequired: string;
  asset: string;
  paymentEndpoint: string;
  chain: string;
}

export interface BalanceResult {
  usdc: number;
  usdt: number;
}

// ElizaOS framework interfaces — reproduced here to avoid runtime dependency
export interface ElizaMessage {
  content?: {
    text?: string;
    action?: string;
  };
  userId?: string;
  roomId?: string;
}

export interface ElizaRuntime {
  getSetting?: (key: string) => string | undefined;
  getMemory?: (key: string) => Promise<any>;
  setMemory?: (key: string, value: any) => Promise<void>;
}

export interface ElizaState {
  [key: string]: any;
}

export type ElizaCallback = (response: { text: string; action?: string }) => void;

export interface ElizaAction {
  name: string;
  description: string;
  examples: string[][];
  validate: (runtime: ElizaRuntime, message: ElizaMessage) => Promise<boolean>;
  handler: (
    runtime: ElizaRuntime,
    message: ElizaMessage,
    state: ElizaState,
    options: Record<string, any>,
    callback: ElizaCallback
  ) => Promise<void>;
}

export interface ElizaProvider {
  get: (runtime: ElizaRuntime, message: ElizaMessage, state: ElizaState) => Promise<string>;
}

export interface ElizaPlugin {
  name: string;
  description: string;
  actions: ElizaAction[];
  providers: ElizaProvider[];
}
