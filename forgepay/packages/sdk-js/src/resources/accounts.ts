import type { FPHttpClient } from '../client.js';

export interface Account {
  id:              string;
  merchant_id:     string;
  account_number:  string;
  email:           string;
  display_name?:   string;
  account_type:    'custodial' | 'self_custodial';
  kyc_status:      'not_started' | 'pending' | 'approved' | 'rejected' | 'requires_review';
  risk_score:      number;
  balance_usdc:    string;
  balance_usdt:    string;
  default_chain:   string;
  wallet_address?: string;
  kms_key_id?:     string;
  is_active:       boolean;
  created_at:      string;
  updated_at:      string;
}

export interface AccountCreateParams {
  merchant_id:     string;
  email:           string;
  display_name?:   string;
  default_chain?:  'polygon' | 'base' | 'ethereum' | 'arbitrum';
  account_type?:   'custodial' | 'self_custodial';
}

export interface KycSubmitParams {
  first_name:    string;
  last_name:     string;
  email:         string;
  date_of_birth: string;
  address: {
    line1:       string;
    city:        string;
    country:     string;
    postal_code: string;
  };
  document_type?: 'passport' | 'driving_licence' | 'national_identity_card';
}

export interface KycVerification {
  id:                  string;
  account_id:          string;
  status:              'not_started' | 'pending' | 'approved' | 'rejected' | 'requires_review';
  risk_score:          number;
  ofac_match:          boolean;
  pep_match:           boolean;
  rejection_reason?:   string;
  created_at:          string;
  completed_at?:       string;
}

export interface AccountBalance {
  account_id:     string;
  usdc:           string;
  usdt:           string;
  chain_balances: Record<string, { usdc: string; usdt: string }>;
}

export interface DepositCreateParams {
  amount_usd: number;
  chain?:     'polygon' | 'base' | 'ethereum' | 'arbitrum';
}

export interface Deposit {
  id:              string;
  account_id:      string;
  merchant_id:     string;
  amount_usd:      number;
  amount_units:    string;
  chain:           string;
  deposit_address: string;
  status:          'pending' | 'processing' | 'confirmed' | 'failed';
  tx_hash?:        string;
  created_at:      string;
  expires_at:      string;
  confirmed_at?:   string;
  transaction_id?: string;
}

export interface WithdrawalCreateParams {
  amount_usd:          number;
  wire_account_number: string;
  wire_routing_number: string;
  billing_name:        string;
}

export interface Withdrawal {
  id:               string;
  account_id:       string;
  merchant_id:      string;
  amount_usd:       number;
  fee_usd:          number;
  net_amount_usd:   number;
  status:           'pending' | 'processing' | 'completed' | 'failed';
  created_at:       string;
  completed_at?:    string;
}

export interface AccountTransaction {
  id:             string;
  account_id:     string;
  merchant_id:    string;
  type:           'deposit' | 'withdrawal' | 'internal_transfer';
  amount_usd:     number;
  amount_units:   string;
  token:          string;
  chain:          string;
  status:         string;
  risk_score?:    number;
  fraud_decision?: string;
  tx_hash?:       string;
  created_at:     string;
  completed_at?:  string;
}

export class AccountsResource {
  constructor(private readonly client: FPHttpClient) {}

  /**
   * Create a stablecoin-backed account for a user.
   * Generates an on-chain wallet automatically.
   *
   * ```ts
   * const account = await fp.accounts.create({
   *   merchant_id: 'mer_123',
   *   email: 'user@example.com',
   *   default_chain: 'polygon',
   * });
   * console.log(account.wallet_address); // 0x...
   * ```
   */
  async create(params: AccountCreateParams): Promise<Account> {
    return this.client.post<Account>('/v1/accounts', params);
  }

  async retrieve(accountId: string): Promise<Account> {
    return this.client.get<Account>(`/v1/accounts/${accountId}`);
  }

  async list(params: {
    merchant_id: string;
    limit?:      number;
    kyc_status?: string;
  }): Promise<{ data: Account[] }> {
    return this.client.get<{ data: Account[] }>(
      '/v1/accounts',
      params as Record<string, string | number | undefined>,
    );
  }

  async getBalance(accountId: string): Promise<AccountBalance> {
    return this.client.get<AccountBalance>(`/v1/accounts/${accountId}/balance`);
  }

  /**
   * Submit KYC verification for an account.
   * Required before deposits/withdrawals can be initiated.
   *
   * ```ts
   * await fp.accounts.submitKyc(accountId, {
   *   first_name: 'Jane', last_name: 'Doe',
   *   email: 'jane@example.com',
   *   date_of_birth: '1990-01-15',
   *   address: { line1: '123 Main St', city: 'San Francisco', country: 'US', postal_code: '94105' },
   *   document_type: 'passport',
   * });
   * ```
   */
  async submitKyc(accountId: string, params: KycSubmitParams): Promise<KycVerification> {
    return this.client.post<KycVerification>(`/v1/accounts/${accountId}/kyc`, params);
  }

  async getKycStatus(accountId: string): Promise<KycVerification> {
    return this.client.get<KycVerification>(`/v1/accounts/${accountId}/kyc`);
  }

  /**
   * Initiate a USDC deposit (USD → USDC via Circle).
   * Returns a deposit address for the user to send funds to.
   * KYC must be approved first.
   *
   * ```ts
   * const deposit = await fp.accounts.createDeposit(accountId, {
   *   amount_usd: 500,
   *   chain: 'polygon',
   * });
   * console.log(`Send $${deposit.amount_usd} USDC to ${deposit.deposit_address}`);
   * ```
   */
  async createDeposit(accountId: string, params: DepositCreateParams): Promise<Deposit> {
    return this.client.post<Deposit>(`/v1/accounts/${accountId}/deposits`, params);
  }

  async getDeposit(accountId: string, depositId: string): Promise<Deposit> {
    return this.client.get<Deposit>(`/v1/accounts/${accountId}/deposits/${depositId}`);
  }

  async listDeposits(
    accountId: string,
    params?: { limit?: number },
  ): Promise<{ data: Deposit[] }> {
    return this.client.get<{ data: Deposit[] }>(
      `/v1/accounts/${accountId}/deposits`,
      params as Record<string, string | number | undefined>,
    );
  }

  /**
   * Initiate a USD withdrawal (USDC → USD via Circle wire transfer).
   * KYC must be approved and balance must be sufficient.
   * A withdrawal fee applies (default 0.5%).
   */
  async createWithdrawal(accountId: string, params: WithdrawalCreateParams): Promise<Withdrawal> {
    return this.client.post<Withdrawal>(`/v1/accounts/${accountId}/withdrawals`, params);
  }

  async getWithdrawal(accountId: string, withdrawalId: string): Promise<Withdrawal> {
    return this.client.get<Withdrawal>(`/v1/accounts/${accountId}/withdrawals/${withdrawalId}`);
  }

  async listTransactions(
    accountId: string,
    params?: { limit?: number; type?: string; status?: string },
  ): Promise<{ data: AccountTransaction[] }> {
    return this.client.get<{ data: AccountTransaction[] }>(
      `/v1/accounts/${accountId}/transactions`,
      params as Record<string, string | number | undefined>,
    );
  }
}
