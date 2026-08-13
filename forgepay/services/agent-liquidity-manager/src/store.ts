/**
 * In-Memory Store
 * ──────────────────────────────────────────────────────────────────────────────
 * Agent wallets, liquidity policies, portfolio targets, and event history.
 * This in-memory map is the source of truth for a running instance; Postgres
 * (db.ts) is best-effort persistence layered on top — see persistAsync().
 */

import {
  AgentWallet,
  AssetBalance,
  AssetClass,
  HistoryEvent,
  HistoryEventType,
  LiquidityPolicy,
  PortfolioTarget,
  RebalanceAction,
  RebalanceLegResult,
} from './types';
import { recomputeWalletUsd, getAssetClass, toUsd, USD_RATES } from './rebalancer';
import { persistAsync } from './db';
import { hashApiKey, safeEqualHex } from './hash';
import { randomBytes } from 'node:crypto';

const wallets:  Map<string, AgentWallet>       = new Map();
const policies: Map<string, LiquidityPolicy>   = new Map();
const targets:  Map<string, PortfolioTarget>   = new Map();
const history:  HistoryEvent[]                 = [];

/**
 * Per-agent API key hashes, keyed by agentId. Like `policies`/`targets`, this
 * is in-memory only (no Postgres table) — the raw key is shown once to the
 * caller at issue time via `issueAgentApiKey()` and never again. Restarting
 * the service invalidates issued agent keys, matching this service's
 * existing volatility model for everything except wallets (see db.ts).
 */
const agentApiKeyHashes: Map<string, string> = new Map();

let walletSeq = 0;
let eventSeq  = 0;

// ── Wallets ───────────────────────────────────────────────────────────────────

function persistWallet(w: AgentWallet): void {
  persistAsync(
    `INSERT INTO agent_wallets (wallet_id, agent_id, chain, address, assets, updated_at)
     VALUES ($1,$2,$3,$4,$5,NOW())
     ON CONFLICT (wallet_id) DO UPDATE SET
       assets = EXCLUDED.assets, chain = EXCLUDED.chain, address = EXCLUDED.address, updated_at = NOW()`,
    [w.walletId, w.agentId, w.chain, w.address, JSON.stringify(w.assets)],
  );
}

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
  persistWallet(wallet);
  return wallet;
}

export function updateWalletAssets(walletId: string, assets: AssetBalance[]): AgentWallet | null {
  const w = wallets.get(walletId);
  if (!w) return null;
  w.assets    = recomputeWalletUsd(assets);
  w.updatedAt = new Date().toISOString();
  wallets.set(walletId, w);
  persistWallet(w);
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

// ── Rebalance execution ────────────────────────────────────────────────────────
//
// computeRebalance() (rebalancer.ts) only computes WHICH class-level legs
// should move — it is pure math over a wallet snapshot and never touches
// tracked state. The functions below are what actually move balances.
//
// Atomicity boundary: PER-LEG. Each leg is validated against a fresh read of
// current wallet state and, only if the full amount is available, applied in
// one synchronous pass (draw-down plan computed first, mutations committed
// after — no partial writes if validation fails). A leg that fails (e.g.
// insufficient balance because an earlier leg in the same batch already
// consumed it, or because wallet state changed since computeRebalance() ran)
// is reported as `status: 'failed'` and does NOT roll back any sibling leg
// that already committed. We chose per-leg (not whole-batch-or-nothing)
// atomicity because legs are economically independent asset-class moves —
// failing to fund one leg is no reason to undo other legs that already
// successfully rebalanced a different pair of classes.
//
// Idempotency: because every leg re-reads wallet state fresh (rather than
// reusing the balances the caller's computeRebalance() snapshot was based
// on), and because execution actually mutates class-level allocations toward
// target, a second `POST /rebalance?execute=true` call recomputes drift from
// the now-updated wallets. If the first call closed the drift, the second
// call's computeRebalance() naturally returns zero legs — no explicit
// dedupe/guard needed. This is verified in src/tests/rebalance-exec.test.ts.

/** Canonical asset credited into a wallet when a leg buys into a class. */
const CLASS_PRIMARY_ASSET: Partial<Record<AssetClass, string>> = {
  stables:    'USDC',
  treasuries: 'USDY',
  eth:        'ETH',
  btc:        'BTC',
  // 'other' has no canonical asset — legs targeting it fail explicitly.
};

const LEG_EPSILON = 0.01; // one cent tolerance for float drift

interface DrawCandidate {
  walletId: string;
  index:    number;
  usd:      number;
  rate:     number;
}

/** Collect every (wallet, asset) entry belonging to `cls` for the agent, largest USD first. */
function drawCandidates(agentId: string, cls: AssetClass): DrawCandidate[] {
  const candidates: DrawCandidate[] = [];
  for (const w of getWalletsForAgent(agentId)) {
    w.assets.forEach((a, index) => {
      if (getAssetClass(a.asset) !== cls) return;
      const usd  = a.balanceUsd > 0 ? a.balanceUsd : toUsd(a.balanceNative, a.asset);
      const rate = USD_RATES[a.asset.toUpperCase()] ?? 0;
      if (usd <= 0 || rate <= 0) return;
      candidates.push({ walletId: w.walletId, index, usd, rate });
    });
  }
  candidates.sort((a, b) => b.usd - a.usd);
  return candidates;
}

/**
 * Attempt to actually apply one RebalanceAction: debit `fromAsset`-class
 * holdings and credit the canonical `toAsset` asset, within the same
 * wallet(s) the debit was drawn from. Returns a RebalanceLegResult — never
 * throws for expected failure modes (insufficient balance, unsupported
 * destination class); those are reported in the result instead.
 */
export function executeRebalanceLeg(agentId: string, action: RebalanceAction): RebalanceLegResult {
  const executedAt = new Date().toISOString();
  const destAsset = CLASS_PRIMARY_ASSET[action.toAsset];
  if (!destAsset) {
    return {
      ...action,
      status: 'failed',
      executedAt,
      error: `No canonical asset configured for destination class "${action.toAsset}"`,
    };
  }

  // 1. Build the debit plan against a FRESH read of current wallet state
  //    (not whatever snapshot computeRebalance() was called with) — this is
  //    what makes execution self-correcting/idempotent and what surfaces a
  //    real insufficient-balance failure instead of silently over-drafting.
  const candidates = drawCandidates(agentId, action.fromAsset);
  let remaining = action.amountUsd;
  const debits: { walletId: string; index: number; take: number; rate: number }[] = [];
  for (const c of candidates) {
    if (remaining <= LEG_EPSILON) break;
    const take = Math.min(c.usd, remaining);
    debits.push({ walletId: c.walletId, index: c.index, take, rate: c.rate });
    remaining -= take;
  }

  if (remaining > LEG_EPSILON) {
    const available = action.amountUsd - remaining;
    return {
      ...action,
      status: 'failed',
      executedAt,
      error: `Insufficient balance in ${action.fromAsset}: needed $${action.amountUsd.toFixed(2)}, ` +
             `available $${available.toFixed(2)}`,
    };
  }

  // 2. Plan is fully funded — apply debit + credit per wallet. This loop is
  //    synchronous with no I/O in between, so nothing else in this process
  //    can observe or mutate wallet state mid-application: the leg commits
  //    as a whole or (per the check above) not at all.
  const destRate = USD_RATES[destAsset.toUpperCase()] ?? 0;
  for (const d of debits) {
    const wallet = getWallet(d.walletId);
    if (!wallet) continue;
    const nextAssets = wallet.assets.map(a => ({ ...a }));
    const src = nextAssets[d.index]!;
    src.balanceNative = Math.max(0, src.balanceNative - d.take / d.rate);

    const destIndex = nextAssets.findIndex(a => a.asset.toUpperCase() === destAsset.toUpperCase());
    const creditNative = destRate > 0 ? d.take / destRate : 0;
    if (destIndex >= 0) {
      nextAssets[destIndex]!.balanceNative += creditNative;
    } else {
      nextAssets.push({
        asset:         destAsset,
        balanceNative: creditNative,
        balanceUsd:    0, // recomputed by updateWalletAssets()
        chain:         wallet.chain,
      });
    }
    updateWalletAssets(d.walletId, nextAssets);
  }

  return { ...action, status: 'executed', executedAt };
}

/**
 * Execute every leg of a rebalance plan in sequence. Each leg is independent
 * (see executeRebalanceLeg doc) — a failed leg is recorded and execution
 * continues with the remaining legs rather than aborting the whole batch.
 */
export function executeRebalancePlan(agentId: string, actions: RebalanceAction[]): RebalanceLegResult[] {
  return actions.map(action => executeRebalanceLeg(agentId, action));
}

// ── Sweep / liquidate balance mutation ─────────────────────────────────────────
//
// sweepToYield()/liquidateFromYield() (sweeper.ts) already perform the real
// side effect of calling out to the yield-engine — they are not stubs. But
// neither one updates this service's own tracked wallet balances, so the
// same idle/deficit amount would be recomputed (and re-swept/re-liquidated)
// on every subsequent call. These two functions close that gap: on a
// successful sweep, the swept stablecoin balance is debited out of the
// wallet (it now lives in the external yield vault); on a successful
// liquidate, the withdrawn amount is credited back in. This makes repeat
// calls naturally idempotent, mirroring the rebalance fix above.

/** Debit up to `amountUsd` worth of `cls`-class holdings for an agent. Returns amount actually debited. */
export function debitAssetClassAcrossWallets(agentId: string, cls: AssetClass, amountUsd: number): number {
  if (amountUsd <= 0) return 0;
  const candidates = drawCandidates(agentId, cls);
  let remaining = amountUsd;
  for (const c of candidates) {
    if (remaining <= LEG_EPSILON) break;
    const take = Math.min(c.usd, remaining);
    const wallet = getWallet(c.walletId);
    if (!wallet) continue;
    const nextAssets = wallet.assets.map(a => ({ ...a }));
    nextAssets[c.index]!.balanceNative = Math.max(0, nextAssets[c.index]!.balanceNative - take / c.rate);
    updateWalletAssets(c.walletId, nextAssets);
    remaining -= take;
  }
  return amountUsd - Math.max(0, remaining);
}

/** Credit `amountUsd` worth of `asset` back into the agent's first wallet (funds returning from a yield vault). */
export function creditAssetToAgent(agentId: string, asset: string, amountUsd: number): number {
  if (amountUsd <= 0) return 0;
  const agentWallets = getWalletsForAgent(agentId);
  const target = agentWallets[0];
  if (!target) return 0;

  const rate = USD_RATES[asset.toUpperCase()] ?? 1;
  const nativeAmt = amountUsd / rate;
  const nextAssets = target.assets.map(a => ({ ...a }));
  const idx = nextAssets.findIndex(a => a.asset.toUpperCase() === asset.toUpperCase());
  if (idx >= 0) {
    nextAssets[idx]!.balanceNative += nativeAmt;
  } else {
    nextAssets.push({ asset, balanceNative: nativeAmt, balanceUsd: 0, chain: target.chain });
  }
  updateWalletAssets(target.walletId, nextAssets);
  return amountUsd;
}

// ── Agent API keys ────────────────────────────────────────────────────────────

/**
 * Mint (or rotate) an API key for an agent. The raw key is returned to the
 * caller exactly once — only its sha256 hash is retained. Rotating replaces
 * the previous key outright, so a leaked key can be invalidated by issuing a
 * new one.
 */
export function issueAgentApiKey(agentId: string): { agentId: string; apiKey: string } {
  const apiKey = `alm_${randomBytes(24).toString('base64url')}`;
  agentApiKeyHashes.set(agentId, hashApiKey(apiKey));
  return { agentId, apiKey };
}

/** True once an agent has been issued a key (used by tests/diagnostics). */
export function hasAgentApiKey(agentId: string): boolean {
  return agentApiKeyHashes.has(agentId);
}

/** Resolve a presented key hash to the agentId that owns it, or null. */
export function findAgentIdByKeyHash(presentedHash: string): string | null {
  for (const [agentId, hash] of agentApiKeyHashes) {
    if (safeEqualHex(presentedHash, hash)) return agentId;
  }
  return null;
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
  agentApiKeyHashes.clear();
  history.length = 0;
  walletSeq = 0;
  eventSeq  = 0;
}
