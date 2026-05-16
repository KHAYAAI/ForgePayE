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
}

let fxCache: FxCache | null = null;
const FX_CACHE_TTL_MS = 3_600_000; // 1 hour

export async function refreshFxRates(): Promise<Record<string, number>> {
  const url = process.env['FX_RATES_URL'];
  if (!url) {
    // No external provider configured — use static rates
    fxCache = { rates: { ...STATIC_FX_RATES }, fetchedAt: Date.now() };
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
    };
    console.info('[enterprise-treasury] FX rates refreshed from', url);
  } catch (err) {
    console.warn('[enterprise-treasury] FX rate refresh failed, using cached/static:', (err as Error).message);
    if (!fxCache) {
      fxCache = { rates: { ...STATIC_FX_RATES }, fetchedAt: Date.now() };
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

export async function refreshAccountBalances(bankConnectivityUrl: string): Promise<AccountBalance[]> {
  lastRefreshAttempt = new Date().toISOString();

  try {
    const resp = await fetch(`${bankConnectivityUrl}/v1/accounts/balances`, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'x-source': 'enterprise-treasury' },
    });

    if (!resp.ok) throw new Error(`bank-connectivity returned ${resp.status}`);

    const body = (await resp.json()) as { accounts?: unknown[] };
    const raw: unknown[] = body?.accounts ?? [];

    connectedAccounts = raw.map((a) => {
      const account = a as Record<string, unknown>;
      const balance  = typeof account['balance']  === 'number' ? account['balance']  : 0;
      const currency = typeof account['currency'] === 'string' ? account['currency'] : 'USD';
      return {
        accountId:    typeof account['account_id'] === 'string' ? account['account_id'] : String(account['id'] ?? ''),
        bankName:     typeof account['institution'] === 'string' ? account['institution'] : 'Unknown Bank',
        accountName:  typeof account['name'] === 'string' ? account['name'] : 'Unnamed Account',
        accountType:  (['checking', 'savings', 'money_market', 'crypto'].includes(String(account['account_type'])))
                        ? account['account_type'] as AccountBalance['accountType']
                        : 'checking',
        currency,
        balanceNative: balance,
        balanceUsd:    toUsd(balance, currency),
        subsidiary:    typeof account['subsidiary'] === 'string' ? account['subsidiary'] : 'HQ',
        plaidItemId:   typeof account['plaid_item_id'] === 'string' ? account['plaid_item_id'] : undefined,
        lastUpdated:   new Date().toISOString(),
      };
    });
  } catch (err) {
    // Serve stale cache so callers can detect age via lastUpdated fields
    console.warn('[enterprise-treasury] bank-connectivity unavailable, serving cached data:', (err as Error).message);
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

export function getFxRateSnapshot(): { rates: Record<string, number>; fetchedAt: string | null } {
  return {
    rates:     fxCache?.rates ?? STATIC_FX_RATES,
    fetchedAt: fxCache ? new Date(fxCache.fetchedAt).toISOString() : null,
  };
}
