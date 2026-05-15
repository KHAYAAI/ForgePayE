/**
 * Cash Consolidation Engine
 *
 * Queries the bank-connectivity service to retrieve all connected bank accounts
 * and produces a unified cash position view. Handles FX conversion and groups
 * balances by subsidiary and currency.
 *
 * In production:
 *   - FX rates should be fetched from a live provider (e.g. Open Exchange Rates)
 *   - Account data should be persisted in PostgreSQL
 *   - Burn rate should be sourced from the liquidity-forecaster service
 */

import axios from 'axios';
import { AccountBalance, CashPosition, SubsidiaryPosition } from './types';

// Static FX rates (USD as base). In production: fetch from live API every hour.
const FX_RATES: Record<string, number> = {
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
  USDC: 1.0,
  USDT: 1.0,
};

function toUsd(amount: number, currency: string): number {
  return amount * (FX_RATES[currency.toUpperCase()] ?? 1.0);
}

// In-memory account cache. In production: PostgreSQL with Redis cache.
let connectedAccounts: AccountBalance[] = [];
let lastRefreshAttempt: string | null = null;

export async function refreshAccountBalances(bankConnectivityUrl: string): Promise<AccountBalance[]> {
  lastRefreshAttempt = new Date().toISOString();

  try {
    const resp = await axios.get(`${bankConnectivityUrl}/v1/accounts/balances`, {
      timeout: 10_000,
      headers: { 'x-source': 'enterprise-treasury' },
    });

    const raw: unknown[] = (resp.data as { accounts?: unknown[] })?.accounts ?? [];

    connectedAccounts = raw.map((a) => {
      const account = a as Record<string, unknown>;
      const balance = typeof account['balance'] === 'number' ? account['balance'] : 0;
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
    // Bank-connectivity is down — serve stale cache with existing timestamps
    // so callers can detect the data age via lastUpdated fields.
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

    // --- Group by subsidiary ---
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

    // --- Group by currency ---
    const cur = account.currency.toUpperCase();
    if (!byCurrencyRaw[cur]) byCurrencyRaw[cur] = { native: 0, usd: 0, count: 0 };
    byCurrencyRaw[cur].native += account.balanceNative;
    byCurrencyRaw[cur].usd   += account.balanceUsd;
    byCurrencyRaw[cur].count += 1;
  }

  // --- Runway calculation ---
  // Simplified: assume daily burn = 0.3% of total portfolio.
  // In production: query the liquidity-forecaster service for per-subsidiary burn rates.
  const dailyBurnUsd = totalUsd * 0.003;
  for (const sub of Object.values(bySubsidiary)) {
    sub.runwayDays = dailyBurnUsd > 0
      ? Math.round(sub.totalUsd / (dailyBurnUsd * (sub.totalUsd / Math.max(totalUsd, 1))))
      : 999;
  }

  // --- Yield tracking ---
  // Simplified: assume 40% idle, 10% deployed in yield protocols.
  // In production: query yield-engine service for actual deployed positions.
  const idleCashUsd          = totalUsd * 0.40;
  const deployedInYieldUsd   = totalUsd * 0.10;
  const opportunityCostUsdPerYear = idleCashUsd * 0.04; // 4% opportunity cost on idle cash

  const byCurrency = Object.fromEntries(
    Object.entries(byCurrencyRaw).map(([cur, data]) => [
      cur,
      {
        currency:      cur,
        balanceNative: data.native,
        balanceUsd:    data.usd,
        fxRate:        FX_RATES[cur] ?? 1.0,
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
