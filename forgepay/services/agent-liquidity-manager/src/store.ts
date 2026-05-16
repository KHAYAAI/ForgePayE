/**
 * In-Memory Store
 * ──────────────────────────────────────────────────────────────────────────────
 * Agent wallets, liquidity policies, portfolio targets, and event history.
 * Production deployment will swap this for Postgres + Redis.
 */

import {
  AgentWallet,
  AssetBalance,
  HistoryEvent,
  HistoryEventType,
  LiquidityPolicy,
  PortfolioTarget,
} from './types';
import { recomputeWalletUsd } from './rebalancer';

const wallets:  Map<string, AgentWallet>       = new Map();
const policies: Map<string, LiquidityPolicy>   = new Map();
const targets:  Map<string, PortfolioTarget>   = new Map();
const history:  HistoryEvent[]                 = [];

let walletSeq = 0;
let eventSeq  = 0;

// ── Wallets ───────────────────────────────────────────────────────────────────

export function registerWallet(
  agentId: string,
  chain: string,
  address: string,
  assets: AssetBalance[],
): AgentWallet {
  walletSeq += 1;
  const now = new Date().toISOString();
  const wallet: AgentWallet = {
    walletId:  `w_${walletSeq}_${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    chain,
    address,
    assets:    recomputeWalletUsd(assets),
    createdAt: now,
    updatedAt: now,
  };
  wallets.set(wallet.walletId, wallet);
  return wallet;
}

export function updateWalletAssets(walletId: string, assets: AssetBalance[]): AgentWallet | null {
  const w = wallets.get(walletId);
  if (!w) return null;
  w.assets    = recomputeWalletUsd(assets);
  w.updatedAt = new Date().toISOString();
  wallets.set(walletId, w);
  return w;
}

export function getWallet(walletId: string): AgentWallet | null {
  return wallets.get(walletId) ?? null;
}

export function getWalletsForAgent(agentId: string): AgentWallet[] {
  return Array.from(wallets.values()).filter(w => w.agentId === agentId);
}

export function listAllWallets(): AgentWallet[] {
  return Array.from(wallets.values());
}

// ── Policies ──────────────────────────────────────────────────────────────────

export function setPolicy(p: Omit<LiquidityPolicy, 'updatedAt'>): LiquidityPolicy {
  const policy: LiquidityPolicy = { ...p, updatedAt: new Date().toISOString() };
  policies.set(p.agentId, policy);
  return policy;
}

export function getPolicy(agentId: string): LiquidityPolicy | null {
  return policies.get(agentId) ?? null;
}

// ── Targets ───────────────────────────────────────────────────────────────────

export function setTarget(t: Omit<PortfolioTarget, 'updatedAt'>): PortfolioTarget {
  const target: PortfolioTarget = { ...t, updatedAt: new Date().toISOString() };
  targets.set(t.agentId, target);
  return target;
}

export function getTarget(agentId: string): PortfolioTarget | null {
  return targets.get(agentId) ?? null;
}

// ── History ───────────────────────────────────────────────────────────────────

export function appendHistory(agentId: string, type: HistoryEventType, detail: Record<string, unknown>): HistoryEvent {
  eventSeq += 1;
  const ev: HistoryEvent = {
    id:        `h_${eventSeq}_${Math.random().toString(36).slice(2, 8)}`,
    agentId,
    type,
    detail,
    createdAt: new Date().toISOString(),
  };
  history.push(ev);
  return ev;
}

export function getHistory(agentId: string, limit = 50): HistoryEvent[] {
  return history.filter(e => e.agentId === agentId).slice(-limit).reverse();
}

export function getAllHistory(): HistoryEvent[] {
  return history.slice();
}

// ── Test helper ───────────────────────────────────────────────────────────────

export function _resetStoreForTests(): void {
  wallets.clear();
  policies.clear();
  targets.clear();
  history.length = 0;
  walletSeq = 0;
  eventSeq  = 0;
}
