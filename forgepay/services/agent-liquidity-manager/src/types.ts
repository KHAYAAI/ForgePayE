/**
 * Agent Liquidity Manager — Type Definitions
 * ──────────────────────────────────────────────────────────────────────────────
 * Core domain types for managing multi-asset agent portfolios.
 */

export type Asset =
  | 'USDC' | 'USDT' | 'DAI'
  | 'USDY' | 'TBILL' | 'BUIDL'
  | 'ETH'  | 'WETH'
  | 'BTC'  | 'WBTC';

export type AssetClass = 'stables' | 'treasuries' | 'eth' | 'btc' | 'other';

export type Chain = 'ethereum' | 'base' | 'arbitrum' | 'polygon' | 'solana' | 'bitcoin';

export type YieldVault = 'aave' | 'compound' | 'ondo';

export interface AssetBalance {
  asset:          string;
  balanceNative:  number;
  balanceUsd:     number;
  chain:          string;
  yieldApy?:      number;
}

export interface AgentWallet {
  walletId:    string;
  agentId:     string;
  chain:       string;
  address:     string;
  assets:      AssetBalance[];
  createdAt:   string;
  updatedAt:   string;
}

export interface PortfolioTarget {
  agentId:    string;
  stables:    number;
  treasuries: number;
  eth:        number;
  btc:        number;
  other?:     number;
  updatedAt:  string;
}

export interface LiquidityPolicy {
  agentId:                 string;
  minLiquidStableUsd:      number;
  maxIdleStableUsd:        number;
  sweepVault:              YieldVault;
  autoLiquidateBelowUsd:   number;
  allowedAssets:           string[];
  updatedAt:               string;
}

export interface RebalanceAction {
  fromAsset:   AssetClass;
  toAsset:     AssetClass;
  amountUsd:   number;
  reason:      string;
  executedAt?: string;
}

export interface PortfolioSnapshot {
  agentId:           string;
  totalUsd:          number;
  byAsset:           Record<string, { balanceUsd: number; balanceNative: number; chain: string }>;
  byClass:           Record<AssetClass, number>;
  idleStableUsd:     number;
  deployedYieldUsd:  number;
  walletCount:       number;
  snapshotAt:        string;
}

export type HistoryEventType = 'rebalance' | 'sweep' | 'liquidate';

export interface HistoryEvent {
  id:          string;
  agentId:     string;
  type:        HistoryEventType;
  detail:      Record<string, unknown>;
  createdAt:   string;
}
