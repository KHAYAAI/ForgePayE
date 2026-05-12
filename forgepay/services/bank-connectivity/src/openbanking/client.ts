/**
 * Open Banking (EU/UK) adapter for the ForgePay bank-connectivity service.
 *
 * Implements the UK Open Banking Read/Write API v3.1 / Berlin Group NextGenPSD2
 * profile.  The client obtains an OAuth2 client-credentials access token from
 * the ASPSP (bank) and uses it for all subsequent calls.
 *
 * Required env vars:
 *   OB_BASE_URL       — ASPSP base URL, e.g. https://api.bankname.com/open-banking/v3.1
 *   OB_CLIENT_ID      — OAuth2 client ID issued by the ASPSP
 *   OB_CLIENT_SECRET  — OAuth2 client secret
 *
 * Token management:
 *   The client caches the access token in memory and automatically refreshes
 *   it when it is within 60 seconds of expiry.  This avoids a round-trip
 *   on every API call without holding a stale token for long.
 */

import axios, { type AxiosInstance, type AxiosError } from 'axios';
import type {
  OBAccount,
  OBBalance,
  OBTransaction,
  OBPaymentRequest,
} from '../types';
import { logger } from '../lib/logger';

interface TokenCache {
  accessToken: string;
  expiresAt:   number;   // Unix timestamp (ms)
}

export class OpenBankingClient {
  private readonly http:          AxiosInstance;
  private readonly tokenEndpoint: string;
  private readonly clientId:      string;
  private readonly clientSecret:  string;
  private tokenCache:             TokenCache | null = null;

  constructor(
    baseUrl:      string = process.env.OB_BASE_URL      ?? '',
    clientId:     string = process.env.OB_CLIENT_ID     ?? '',
    clientSecret: string = process.env.OB_CLIENT_SECRET ?? '',
  ) {
    if (!baseUrl || !clientId || !clientSecret) {
      throw new Error(
        'OpenBankingClient requires OB_BASE_URL, OB_CLIENT_ID, and OB_CLIENT_SECRET',
      );
    }

    this.clientId      = clientId;
    this.clientSecret  = clientSecret;
    this.tokenEndpoint = `${baseUrl}/oauth2/token`;

    this.http = axios.create({
      baseURL: baseUrl,
      timeout: 15_000,
      headers: {
        'Content-Type': 'application/json',
        Accept:         'application/json',
      },
    });

    // Attach auth token to every outgoing request
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.Authorization = `Bearer ${token}`;
      return config;
    });
  }

  // ── OAuth2 token management ─────────────────────────────────────────────────

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.accessToken;
    }

    const params = new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     this.clientId,
      client_secret: this.clientSecret,
      scope:         'accounts payments',
    });

    try {
      const res = await axios.post<{ access_token: string; expires_in: number }>(
        this.tokenEndpoint,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );

      this.tokenCache = {
        accessToken: res.data.access_token,
        expiresAt:   now + res.data.expires_in * 1000,
      };

      logger.debug('Open Banking access token refreshed');
      return this.tokenCache.accessToken;
    } catch (err) {
      logger.error({ err }, 'Failed to obtain Open Banking access token');
      throw wrapOBError(err, 'OAuth2 token request failed');
    }
  }

  // ── Accounts ────────────────────────────────────────────────────────────────

  /**
   * List all accounts accessible under the given consent ID.
   * The consent is included as a custom header as required by the OB spec.
   */
  async getAccounts(consentId: string): Promise<OBAccount[]> {
    try {
      const res = await this.http.get<{
        Data: { Account: RawOBAccount[] }
      }>('/accounts', {
        headers: { 'x-ob-consent-id': consentId },
      });

      return res.data.Data.Account.map(mapOBAccount);
    } catch (err) {
      logger.error({ err, consentId }, 'OB getAccounts failed');
      throw wrapOBError(err, 'Failed to retrieve Open Banking accounts');
    }
  }

  // ── Balances ────────────────────────────────────────────────────────────────

  /**
   * Retrieve balance information for a specific account.
   */
  async getBalances(accountId: string, consentId: string): Promise<OBBalance[]> {
    try {
      const res = await this.http.get<{
        Data: { Balance: RawOBBalance[] }
      }>(`/accounts/${encodeURIComponent(accountId)}/balances`, {
        headers: { 'x-ob-consent-id': consentId },
      });

      return res.data.Data.Balance.map((b) => mapOBBalance(accountId, b));
    } catch (err) {
      logger.error({ err, accountId }, 'OB getBalances failed');
      throw wrapOBError(err, 'Failed to retrieve Open Banking balances');
    }
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  /**
   * Retrieve transactions for a specific account within a date range.
   * Dates should be ISO-8601 date strings (YYYY-MM-DD).
   */
  async getTransactions(
    accountId: string,
    consentId: string,
    fromDate:  string,
    toDate:    string,
  ): Promise<OBTransaction[]> {
    try {
      const res = await this.http.get<{
        Data: { Transaction: RawOBTransaction[] }
      }>(`/accounts/${encodeURIComponent(accountId)}/transactions`, {
        headers: { 'x-ob-consent-id': consentId },
        params:  { fromBookingDateTime: fromDate, toBookingDateTime: toDate },
      });

      return res.data.Data.Transaction.map((t) => mapOBTransaction(accountId, t));
    } catch (err) {
      logger.error({ err, accountId, fromDate, toDate }, 'OB getTransactions failed');
      throw wrapOBError(err, 'Failed to retrieve Open Banking transactions');
    }
  }

  // ── Payments ────────────────────────────────────────────────────────────────

  /**
   * Initiate a domestic SEPA/Faster Payment via the Open Banking Payments API.
   * Returns the payment ID and initial status from the ASPSP.
   */
  async initiatePayment(
    params: OBPaymentRequest,
  ): Promise<{ paymentId: string; status: string }> {
    const body = {
      Data: {
        ConsentId: params.consentId,
        Initiation: {
          InstructionIdentification: `FP-${Date.now()}`,
          EndToEndIdentification:    params.reference.slice(0, 35),
          InstructedAmount: {
            Amount:   params.amount.toFixed(2),
            Currency: params.currency,
          },
          CreditorAccount: {
            SchemeName:   'IBAN',
            Identification: params.toAccountId,
            Name:           'Beneficiary',
          },
          RemittanceInformation: {
            Reference: params.reference.slice(0, 35),
          },
        },
      },
      Risk: {},
    };

    try {
      const res = await this.http.post<{
        Data: { DomesticPaymentId: string; Status: string }
      }>('/domestic-payments', body, {
        headers: { 'x-ob-consent-id': params.consentId },
      });

      return {
        paymentId: res.data.Data.DomesticPaymentId,
        status:    res.data.Data.Status,
      };
    } catch (err) {
      logger.error({ err, params: { ...params } }, 'OB initiatePayment failed');
      throw wrapOBError(err, 'Failed to initiate Open Banking payment');
    }
  }

  /**
   * Poll the status of a previously submitted domestic payment.
   */
  async getPaymentStatus(paymentId: string): Promise<{ status: string; failureReason?: string }> {
    try {
      const res = await this.http.get<{
        Data: { Status: string; StatusUpdateDateTime: string }
      }>(`/domestic-payments/${encodeURIComponent(paymentId)}`);

      return { status: res.data.Data.Status };
    } catch (err) {
      logger.error({ err, paymentId }, 'OB getPaymentStatus failed');
      throw wrapOBError(err, 'Failed to get Open Banking payment status');
    }
  }
}

// ── Raw API shapes (UK OB spec) ───────────────────────────────────────────────

interface RawOBAccount {
  AccountId:      string;
  Currency:       string;
  AccountType:    string;
  AccountSubType: string;
  Nickname?:      string;
  Account?: Array<{
    SchemeName:     string;
    Identification: string;
    Name?:          string;
    SecondaryIdentification?: string;
  }>;
}

interface RawOBBalance {
  Amount:       { Amount: string; Currency: string };
  CreditDebitIndicator: 'Credit' | 'Debit';
  Type:         string;
  DateTime:     string;
}

interface RawOBTransaction {
  TransactionId?:            string;
  Amount:                    { Amount: string; Currency: string };
  CreditDebitIndicator:      'Credit' | 'Debit';
  Status:                    'Booked' | 'Pending';
  BookingDateTime:           string;
  ValueDateTime?:            string;
  TransactionInformation?:   string;
  BankTransactionCode?: {
    Code?:    string;
    SubCode?: string;
  };
}

// ── Mappers ───────────────────────────────────────────────────────────────────

function mapOBAccount(raw: RawOBAccount): OBAccount {
  const identification = raw.Account?.[0]?.Identification ?? '';
  return {
    accountId:      raw.AccountId,
    currency:       raw.Currency,
    accountType:    raw.AccountType,
    accountSubType: raw.AccountSubType,
    nickname:       raw.Nickname,
    identification,
  };
}

function mapOBBalance(accountId: string, raw: RawOBBalance): OBBalance {
  const amount = parseFloat(raw.Amount.Amount);
  return {
    accountId,
    amount:   raw.CreditDebitIndicator === 'Debit' ? -amount : amount,
    currency: raw.Amount.Currency,
    type:     raw.Type as OBBalance['type'],
    dateTime: raw.DateTime,
  };
}

function mapOBTransaction(accountId: string, raw: RawOBTransaction): OBTransaction {
  const amount = parseFloat(raw.Amount.Amount);
  return {
    transactionId:          raw.TransactionId ?? `ob-${Date.now()}-${Math.random()}`,
    accountId,
    amount:                 raw.CreditDebitIndicator === 'Debit' ? -amount : amount,
    currency:               raw.Amount.Currency,
    creditDebitIndicator:   raw.CreditDebitIndicator,
    status:                 raw.Status,
    bookingDateTime:        raw.BookingDateTime,
    valueDateTime:          raw.ValueDateTime,
    transactionInformation: raw.TransactionInformation,
    bankTransactionCode:    raw.BankTransactionCode?.Code,
  };
}

// ── Error helpers ─────────────────────────────────────────────────────────────

function wrapOBError(err: unknown, fallbackMessage: string): Error {
  const axErr = err as AxiosError<{ Message?: string; Code?: string }>;
  if (axErr.response?.data) {
    const data = axErr.response.data;
    const msg  = data.Message ?? fallbackMessage;
    const code = data.Code ?? axErr.response.status ?? 'OB_ERROR';
    return new Error(`[OpenBanking ${code}] ${msg}`);
  }
  if (err instanceof Error) return err;
  return new Error(fallbackMessage);
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _obClient: OpenBankingClient | null = null;

export function getOpenBankingClient(): OpenBankingClient {
  if (!_obClient) {
    _obClient = new OpenBankingClient();
  }
  return _obClient;
}
