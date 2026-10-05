/**
 * Cash Consolidation Engine
 *
 * Queries the bank-connectivity service to retrieve all connected bank accounts
 * and produces a unified cash position view. Handles FX conversion and groups
 * balances by subsidiary and currency.
 *
 * FX rates are refreshed every hour from an optional external provider
 * (configurable via FX_RATES_URL env var); static fallback rates are used
 * when the provider is unavailable.
 */

import { AccountBalance, CashPosition, SubsidiaryPosition } from './types';

// ── FX Rate Cache ─────────────────────────────────────────────────────────────

const STATIC_FX_RATES: Record<string, number> = {
  USD:  1.0,
  EUR:  1.08,
  GBP:  1.27,
  CAD:  0.74,
  AUD:  0.65,
  SGD:  0.75,
  JPY:  0.0067,
  BRL:  0.20,
  CHF:  1.12,
  SEK:  0.096,
  NOK:  0.093,
  DKK:  0.145,
  HKD:  0.128,
  MXN:  0.059,
  INR:  0.012,
  USDC: 1.0,
  USDT: 1.0,
  WETH: 3200.0,
};

interface FxCache {
  rates: Record<string, number>;
  fetchedAt: number;
  /** Whether these rates came from the provider or the static placeholder table. */
  source: 'live' | 'static';
}

let fxCache: FxCache | null = null;
const FX_CACHE_TTL_MS = 3_600_000; // 1 hour

export async function refreshFxRates(): Promise<Record<string, number>> {
  const url = process.env['FX_RATES_URL'];
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (!url) {
    // STATIC_FX_RATES is a hand-written table (EUR 1.08, GBP 1.27, WETH 3200…).
    // Serving it as the FX book means every consolidated position, exposure
    // figure and netting decision is valued at a placeholder rate. Fine in
    // development; in production it silently misstates the treasury.
    if (isProduction) {
      throw new Error(
        'FX_RATES_URL is not configured. Refusing to value treasury positions ' +
        'with the static placeholder rate table in production.',
      );
    }
    fxCache = { rates: { ...STATIC_FX_RATES }, fetchedAt: Date.now(), source: 'static' };
    return fxCache.rates;
  }

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { 'Accept': 'application/json' },
    });
    if (!resp.ok) throw new Error(`FX provider returned ${resp.status}`);
    const data = (await resp.json()) as { rates?: Record<string, number> };
    const liveRates = data.rates ?? {};
    // Merge: live rates override static, keeping crypto rates from static
    fxCache = {
      rates: { ...STATIC_FX_RATES, ...liveRates },
      fetchedAt: Date.now(),
      source: 'live',
    };
    console.info('[enterprise-treasury] FX rates refreshed from', url);
  } catch (err) {
    console.warn('[enterprise-treasury] FX rate refresh failed:', (err as Error).message);

    // A transient provider failure should not take the service down when we
    // still hold rates that were genuinely live — serve those and let
    // `fetchedAt` expose how old they are. But falling back to the static
    // table would quietly replace real rates with placeholders, so in
    // production that is refused.
    if (!fxCache || fxCache.source === 'static') {
      if (isProduction) {
        throw new Error(
          `FX rate refresh failed and no live rates are cached: ${(err as Error).message}. ` +
          'Refusing to fall back to the static placeholder table in production.',
        );
      }
      fxCache = { rates: { ...STATIC_FX_RATES }, fetchedAt: Date.now(), source: 'static' };
    }
  }
  return fxCache.rates;
}

function getCurrentFxRates(): Record<string, number> {
  if (!fxCache) return STATIC_FX_RATES;
  // Trigger async refresh if cache is stale, but return current synchronously
  if (Date.now() - fxCache.fetchedAt > FX_CACHE_TTL_MS) {
    refreshFxRates().catch(() => {});
  }
  return fxCache.rates;
}

function toUsd(amount: number, currency: string): number {
  const rates = getCurrentFxRates();
  return amount * (rates[currency.toUpperCase()] ?? 1.0);
}

// ── Account cache ─────────────────────────────────────────────────────────────

let connectedAccounts: AccountBalance[] = [];
let lastRefreshAttempt: string | null = null;
let lastRefreshError: string | null = null;

/** Headers bank-connectivity's internal routes require (x-source + shared secret). */
export function internalHeaders(): Record<string, string> {
  const secret = process.env['INTERNAL_SECRET'] ?? '';
  return { 'x-source': 'enterprise-treasury', ...(secret ? { 'x-internal-secret': secret } : {}) };
}

/**
 * Pull this deployment's linked bank accounts and their last fetched balances
 * from bank-connectivity (GET /v1/transfers/internal/balances).
 *
 * Treasury is single-tenant: one deployment per customer, named by
 * TREASURY_MERCHANT_ID. This used to call /v1/accounts/balances, which
 * bank-connectivity never served, swallow the error and show no accounts; it
 * also sent no internal secret. A failure now throws and is recorded, and
 * each account's lastUpdated is when the bank was actually last read.
 */
export async function refreshAccountBalances(bankConnectivityUrl: string): Promise<AccountBalance[]> {
  lastRefreshAttempt = new Date().toISOString();
  const merchantId = process.env['TREASURY_MERCHANT_ID'];
  try {
    if (!merchantId) throw new Error('TREASURY_MERCHANT_ID is not set; no accounts to load');
    const q = new URLSearchParams({ merchantId });
    const resp = await fetch(`${bankConnectivityUrl}/v1/transfers/internal/balances?${q}`, {
      signal: AbortSignal.timeout(10_000),
      headers: internalHeaders(),
    });
    if (!resp.ok) throw new Error(`bank-connectivity returned ${resp.status}`);

    const body = (await resp.json()) as { data?: Array<Record<string, unknown>> };
    const raw = Array.isArray(body?.data) ? body.data : [];
    connectedAccounts = raw.map((a) => {
      const balance  = typeof a['balanceCurrent'] === 'number' ? a['balanceCurrent'] : 0;
      const currency = typeof a['currency'] === 'string' ? a['currency'] : 'USD';
      const type     = String(a['accountType'] ?? '');
      return {
        accountId:     String(a['id'] ?? ''),
        bankName:      typeof a['bankName'] === 'string' ? a['bankName'] : 'Unknown Bank',
        accountName:   typeof a['accountName'] === 'string' ? a['accountName'] : 'Unnamed Account',
        accountType:   (['checking', 'savings', 'money_market', 'crypto'].includes(type) ? type : 'checking') as AccountBalance['accountType'],
        currency,
        balanceNative: balance,
        balanceUsd:    toUsd(balance, currency),
        // Subsidiaries are not modelled in bank-connectivity yet.
        subsidiary:    'HQ',
        lastUpdated:   typeof a['lastRefreshed'] === 'string' ? a['lastRefreshed'] : lastRefreshAttempt!,
      };
    });
    lastRefreshError = null;
  } catch (err) {
    lastRefreshError = (err as Error).message;
    throw err;
  }
  return connectedAccounts;
}

export function consolidateCashPosition(accounts: AccountBalance[]): CashPosition {
  const bySubsidiary: Record<string, SubsidiaryPosition> = {};
  const byCurrencyRaw: Record<string, { native: number; usd: number; count: number }> = {};
  let totalUsd = 0;

  for (const account of accounts) {
    totalUsd += account.balanceUsd;

    if (!bySubsidiary[account.subsidiary]) {
      bySubsidiary[account.subsidiary] = {
        name:         account.subsidiary,
        totalUsd:     0,
        accountCount: 0,
        currencies:   [],
        runwayDays:   0,
        accounts:     [],
      };
    }
    const sub = bySubsidiary[account.subsidiary];
    sub.totalUsd     += account.balanceUsd;
    sub.accountCount += 1;
    sub.accounts.push(account);
    if (!sub.currencies.includes(account.currency)) {
      sub.currencies.push(account.currency);
    }

    const cur = account.currency.toUpperCase();
    if (!byCurrencyRaw[cur]) byCurrencyRaw[cur] = { native: 0, usd: 0, count: 0 };
    byCurrencyRaw[cur].native += account.balanceNative;
    byCurrencyRaw[cur].usd   += account.balanceUsd;
    byCurrencyRaw[cur].count += 1;
  }

  // Runway: daily burn = 0.3% of total portfolio (per-subsidiary proportional).
  // Production: query liquidity-forecaster service for per-subsidiary burn rates.
  const dailyBurnUsd = totalUsd * 0.003;
  for (const sub of Object.values(bySubsidiary)) {
    sub.runwayDays = dailyBurnUsd > 0
      ? Math.round(sub.totalUsd / (dailyBurnUsd * (sub.totalUsd / Math.max(totalUsd, 1))))
      : 999;
  }

  // Yield tracking: in production query yield-engine for actual deployed positions.
  const idleCashUsd              = totalUsd * 0.40;
  const deployedInYieldUsd       = totalUsd * 0.10;
  const opportunityCostUsdPerYear = idleCashUsd * 0.04;

  const rates = getCurrentFxRates();
  const byCurrency = Object.fromEntries(
    Object.entries(byCurrencyRaw).map(([cur, data]) => [
      cur,
      {
        currency:      cur,
        balanceNative: data.native,
        balanceUsd:    data.usd,
        fxRate:        rates[cur] ?? 1.0,
        accountCount:  data.count,
      },
    ])
  );

  return {
    totalUsd,
    bySubsidiary,
    byCurrency,
    idleCashUsd,
    deployedInYieldUsd,
    opportunityCostUsdPerYear,
    lastConsolidated: new Date().toISOString(),
  };
}

export function getAccounts(): AccountBalance[] {
  return connectedAccounts;
}

export function getLastRefreshAttempt(): string | null {
  return lastRefreshAttempt;
}

/** Why the last balance refresh failed, or null if it succeeded. */
export function getLastRefreshError(): string | null {
  return lastRefreshError;
}

export function getFxRateSnapshot(): {
  rates: Record<string, number>;
  fetchedAt: string | null;
  source: 'live' | 'static';
  stale: boolean;
} {
  // `source` is surfaced so a caller can tell a real FX book from the static
  // placeholder table rather than having to assume.
  return {
    rates:     fxCache?.rates ?? STATIC_FX_RATES,
    fetchedAt: fxCache ? new Date(fxCache.fetchedAt).toISOString() : null,
    source:    fxCache?.source ?? 'static',
    stale:     fxCache ? Date.now() - fxCache.fetchedAt > FX_CACHE_TTL_MS : true,
  };
}
