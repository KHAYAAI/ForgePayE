/**
 * Domain types for the ForgePay bank-connectivity service.
 *
 * BankAccount covers both Plaid-linked (US) and Open Banking-linked (EU/UK)
 * accounts. Exactly one of plaidAccountId or obAccountId is populated depending
 * on the provider. "manual" accounts have neither — they are added by the
 * merchant for reference/display only and cannot initiate transfers.
 */

// ── Bank Accounts ─────────────────────────────────────────────────────────────

export interface BankAccount {
  id: string
  merchantId: string
  plaidAccountId?: string
  obAccountId?: string          // Open Banking account identifier
  provider: 'plaid' | 'open_banking' | 'manual'
  accountType: 'checking' | 'savings' | 'money_market'
  currency: string              // ISO 4217 (e.g. "USD", "EUR", "GBP")
  nickname?: string
  mask: string                  // last 4 digits of account number
  status: 'pending' | 'active' | 'disconnected' | 'error'
  balanceCurrent?: number
  balanceAvailable?: number
  balanceLastUpdated?: string   // ISO-8601
  createdAt: string             // ISO-8601
  updatedAt: string             // ISO-8601
}

// Stored separately from BankAccount — never returned to API callers.
export interface BankAccountSecret {
  accountId: string
  encryptedAccessToken: string  // AES-256-GCM ciphertext (see utils/encryption.ts)
  plaidItemId?: string
  obConsentId?: string
}

// ── Plaid Link ────────────────────────────────────────────────────────────────

export interface PlaidLinkToken {
  linkToken: string
  expiration: string            // ISO-8601
  requestId: string
}

export interface PlaidExchangeRequest {
  publicToken: string
  metadata: {
    institution?: { name?: string; institution_id?: string }
    accounts?: Array<{
      id: string
      name: string
      mask: string
      type: string
      subtype: string
    }>
  }
}

// ── Transfers ─────────────────────────────────────────────────────────────────

export interface TransferRequest {
  fromAccountId: string
  toAccountId: string
  amount: number                // in major currency units (e.g. 100.00 for $100)
  currency: string              // ISO 4217
  description: string
  type: 'ach' | 'wire' | 'sepa'
  scheduledDate?: string        // ISO date (YYYY-MM-DD) for scheduled transfers
  idempotencyKey?: string       // caller-supplied dedup key
}

export interface Transfer {
  id: string
  merchantId: string
  fromAccountId: string
  toAccountId: string
  amount: number
  currency: string
  type: 'ach' | 'wire' | 'sepa'
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'
  description: string
  scheduledDate?: string
  settledAt?: string            // ISO-8601 when the transfer cleared
  failureReason?: string
  idempotencyKey?: string
  providerTransferId?: string   // Plaid / bank reference
  createdAt: string             // ISO-8601
  updatedAt: string             // ISO-8601
}

// ── Open Banking ──────────────────────────────────────────────────────────────

export interface OBAccount {
  accountId: string
  currency: string
  accountType: string
  accountSubType: string
  nickname?: string
  identification: string        // masked IBAN / sort code+account
}

export interface OBBalance {
  accountId: string
  amount: number
  currency: string
  type: 'InterimAvailable' | 'InterimBooked' | 'ClosingAvailable' | 'ClosingBooked'
  dateTime: string
}

export interface OBTransaction {
  transactionId: string
  accountId: string
  amount: number
  currency: string
  creditDebitIndicator: 'Credit' | 'Debit'
  status: 'Booked' | 'Pending'
  bookingDateTime: string
  valueDateTime?: string
  transactionInformation?: string
  bankTransactionCode?: string
}

export interface OBPaymentRequest {
  fromAccountId: string
  toAccountId: string           // destination IBAN or sort code+account
  amount: number
  currency: string
  reference: string
  consentId: string
}

// ── JWT payload (decoded from request) ───────────────────────────────────────

export interface JwtPayload {
  sub: string                   // merchantId
  iat: number
  exp: number
  scope?: string
}

// ── Paginated response wrapper ────────────────────────────────────────────────

export interface Paginated<T> {
  data: T[]
  total: number
  page: number
  perPage: number
  hasMore: boolean
}

// ── Error shape ───────────────────────────────────────────────────────────────

export interface ApiError {
  statusCode: number
  error: string
  message: string
  requestId?: string
}
