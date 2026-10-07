/**
 * Mode 2 activity indexer.
 *
 * Reads the stablecoin transfers of an agent's own bound wallet from public EVM
 * chains and keeps a small per-wallet summary, so Mode 2 can be scored from
 * what the wallet actually did, with no integration needed on the agent's side.
 *
 * What it does and does not measure (deliberately narrow):
 *   - Counts and sums ERC-20 `Transfer` events (in and out) for the stablecoins
 *     the operator configured. Tokens are assumed to be USD stablecoins worth $1,
 *     so only configure ones that are.
 *   - Native-currency transactions are NOT indexed. Standard RPC cannot list the
 *     inbound ones, and pricing them needs an oracle.
 *   - A failed transaction emits no Transfer, so the success rate is unknowable
 *     here. It is reported as unknown and left out of the score.
 *   - Self-transfers, mints/burns (zero address) and dust are ignored, and the
 *     score needs a minimum number of transfers and distinct counterparties, so
 *     sending funds back and forth with oneself does not build a history.
 *
 * Reorg safety: only blocks at least `confirmations` behind the head are read,
 * and the cursor only advances over blocks that were read in full.
 *
 * Off by default (ONCHAIN_INDEXER_ENABLED=true). Nothing here is read per
 * request: scoring uses the stored summary.
 */

import { createPublicClient, http, parseAbiItem, type Address } from 'viem';
import { isSolanaAddress } from './did';

// ── Configuration ────────────────────────────────────────────────────────────

export interface TokenConfig { symbol: string; address: string; decimals: number }

export interface ChainConfig {
  /** Absent means an EVM chain. */
  kind?: 'evm';
  chainId: number;
  name: string;
  rpcUrl: string;
  /** First block worth scanning (before the earliest configured token existed is wasted work). */
  startBlock: number;
  /** Blocks behind the head that are considered final enough to read. */
  confirmations: number;
  /** Largest block range asked of the RPC in one call; halved automatically if the provider refuses. */
  maxBlockRange: number;
  tokens: TokenConfig[];
}

/**
 * A Solana cluster. There are no blocks to scan: activity is read per token account, newest to oldest, in pages of
 * signatures, at `finalized` commitment (which cannot be rolled back, so no confirmation depth is needed). `tokens[].address`
 * is the token's mint address. `chainId` is only a label to keep summaries apart from EVM chains; use 101 for mainnet.
 */
export interface SolanaChainConfig {
  kind: 'solana';
  chainId: number;
  name: string;
  rpcUrl: string;
  pageSize: number;
  tokens: TokenConfig[];
}

export type AnyChainConfig = ChainConfig | SolanaChainConfig;

export interface IndexerLimits {
  /** Fewest qualifying transfers before a wallet is scored at all. */
  minTransfers: number;
  /** Fewest distinct counterparties before a wallet is scored at all. */
  minCounterparties: number;
  /** Transfers below this many USD cents are ignored (address-poisoning dust). */
  dustCents: number;
}

export const DEFAULT_LIMITS: IndexerLimits = { minTransfers: 5, minCounterparties: 3, dustCents: 1 };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const MAX_COUNTERPARTIES_TRACKED = 1000;
const ZERO = '0x0000000000000000000000000000000000000000';
const SOLANA_SYSTEM = '11111111111111111111111111111111';

/** EVM addresses compare case-insensitively; Solana's base58 changes meaning with case and is kept verbatim. */
export function normAddr(address: string): string {
  return /^0x/i.test(address) ? address.toLowerCase() : address;
}

export function indexerEnabled(): boolean {
  return process.env['ONCHAIN_INDEXER_ENABLED'] === 'true';
}

/**
 * Parse ONCHAIN_CHAINS, a JSON array. There are no built-in token addresses: a
 * wrong address would score the wrong asset without any error, so the operator
 * supplies them from each issuer's published list. Throws with a precise message.
 */
export function parseChains(raw: string | undefined): AnyChainConfig[] {
  if (!raw) throw new Error('ONCHAIN_CHAINS is required when ONCHAIN_INDEXER_ENABLED=true');
  let data: unknown;
  try { data = JSON.parse(raw); } catch { throw new Error('ONCHAIN_CHAINS is not valid JSON'); }
  if (!Array.isArray(data) || data.length === 0) throw new Error('ONCHAIN_CHAINS must be a non-empty array');
  const seen = new Set<number>();
  return data.map((c: any, i: number) => {
    const at = `ONCHAIN_CHAINS[${i}]`;
    const posInt = (v: unknown, f: string, min = 1) => {
      if (!Number.isInteger(v) || (v as number) < min) throw new Error(`${at}.${f} must be an integer >= ${min}`);
      return v as number;
    };
    const chainId = posInt(c?.chainId, 'chainId');
    if (seen.has(chainId)) throw new Error(`${at}: chainId ${chainId} is listed twice`);
    seen.add(chainId);
    if (typeof c?.name !== 'string' || !c.name) throw new Error(`${at}.name is required`);
    if (typeof c?.rpcUrl !== 'string' || !/^https?:\/\//.test(c.rpcUrl)) throw new Error(`${at}.rpcUrl must be an http(s) URL`);
    if (!Array.isArray(c?.tokens) || c.tokens.length === 0) throw new Error(`${at}.tokens must list at least one stablecoin`);
    if (c.kind !== undefined && c.kind !== 'evm' && c.kind !== 'solana') throw new Error(`${at}.kind must be "evm" or "solana"`);
    const solana = c.kind === 'solana';
    const tokens: TokenConfig[] = c.tokens.map((t: any, j: number) => {
      if (typeof t?.symbol !== 'string' || !t.symbol) throw new Error(`${at}.tokens[${j}].symbol is required`);
      if (solana) {
        if (!isSolanaAddress(t?.address)) throw new Error(`${at}.tokens[${j}].address is not a valid Solana mint address`);
        return { symbol: t.symbol, address: t.address, decimals: posInt(t.decimals, `tokens[${j}].decimals`, 0) };   // case-sensitive
      }
      if (typeof t?.address !== 'string' || !ADDRESS_RE.test(t.address)) throw new Error(`${at}.tokens[${j}].address is not a valid address`);
      return { symbol: t.symbol, address: t.address.toLowerCase(), decimals: posInt(t.decimals, `tokens[${j}].decimals`, 0) };
    });
    if (solana) {
      return { kind: 'solana' as const, chainId, name: c.name, rpcUrl: c.rpcUrl, tokens, pageSize: c.pageSize === undefined ? 50 : posInt(c.pageSize, 'pageSize') };
    }
    return {
      chainId, name: c.name, rpcUrl: c.rpcUrl, tokens,
      startBlock: posInt(c.startBlock, 'startBlock', 0),
      confirmations: c.confirmations === undefined ? 12 : posInt(c.confirmations, 'confirmations', 0),
      maxBlockRange: c.maxBlockRange === undefined ? 2000 : posInt(c.maxBlockRange, 'maxBlockRange'),
    };
  });
}

let configured: AnyChainConfig[] = [];
export function setConfiguredChains(c: AnyChainConfig[]): void { configured = c; }
export function configuredChains(): AnyChainConfig[] { return configured; }

/** Optional overrides; anything that is not a positive integer is ignored in favour of the default. */
export function limitsFromEnv(env: NodeJS.ProcessEnv = process.env): IndexerLimits {
  const n = (v: string | undefined, d: number) => { const x = Number(v); return Number.isInteger(x) && x >= 1 ? x : d; };
  return {
    minTransfers: n(env['ONCHAIN_MIN_TRANSFERS'], DEFAULT_LIMITS.minTransfers),
    minCounterparties: n(env['ONCHAIN_MIN_COUNTERPARTIES'], DEFAULT_LIMITS.minCounterparties),
    dustCents: n(env['ONCHAIN_DUST_CENTS'], DEFAULT_LIMITS.dustCents),
  };
}

// ── Source: the only part that talks to a chain ──────────────────────────────

export interface RawTransfer {
  logIndex: number;
  blockNumber: number;
  from: string;
  to: string;
  value: bigint;
}

export interface ChainSource {
  head(): Promise<number>;
  transfers(token: string, wallet: string, fromBlock: number, toBlock: number): Promise<RawTransfer[]>;
  blockTimestamp(block: number): Promise<number>;
}

const TRANSFER_EVENT = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');

export function viemSource(cfg: ChainConfig): ChainSource {
  const client = createPublicClient({ transport: http(cfg.rpcUrl, { retryCount: 2, timeout: 20_000 }) });
  return {
    head: async () => Number(await client.getBlockNumber()),
    blockTimestamp: async (n) => Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp),
    transfers: async (token, wallet, fromBlock, toBlock) => {
      const range = { address: token as Address, event: TRANSFER_EVENT, fromBlock: BigInt(fromBlock), toBlock: BigInt(toBlock) };
      const [out, inn] = await Promise.all([
        client.getLogs({ ...range, args: { from: wallet as Address } }),
        client.getLogs({ ...range, args: { to: wallet as Address } }),
      ]);
      const byKey = new Map<string, RawTransfer>();
      for (const l of [...out, ...inn]) {
        const a = l.args as { from?: string; to?: string; value?: bigint };
        if (l.blockNumber == null || l.logIndex == null || !a.from || !a.to || a.value == null) continue;
        byKey.set(`${l.transactionHash}:${l.logIndex}`, {
          logIndex: l.logIndex, blockNumber: Number(l.blockNumber), from: a.from.toLowerCase(), to: a.to.toLowerCase(), value: a.value,
        });
      }
      return [...byKey.values()];
    },
  };
}

// ── Summary ──────────────────────────────────────────────────────────────────

export interface ActivitySummary {
  address: string;
  chainId: number;
  /** Highest block read in full. Everything at or below it has been counted. */
  cursor: number;
  transferCount: number;
  inboundCount: number;
  outboundCount: number;
  volumeCents: number;
  /** Capped list; enough to count distinct counterparties and to union across chains. */
  counterparties: string[];
  firstSeenBlock: number | null;
  firstSeenAt: string | null;
  indexedAt: string;
  lastError: string | null;
  /** Solana only: where reading has got to, per token account. Absent for EVM chains. */
  solana?: { accounts: Record<string, SolanaAccountState> };
  /** Solana only: transactions the RPC could not return (pruned), so they could not be counted. */
  skipped?: number;
}

/**
 * Newest-first paging state for one token account. `newest` is the most recent signature fully read; `pendingNewest`/`fwdBefore`
 * track a catch-up on new activity that spans several pages; `before`/`done` track the backfill of older history.
 */
export interface SolanaAccountState {
  newest: string | null;
  pendingNewest: string | null;
  fwdBefore: string | null;
  before: string | null;
  done: boolean;
}

export function emptySummary(address: string, cfg: AnyChainConfig): ActivitySummary {
  return {
    address: normAddr(address), chainId: cfg.chainId, cursor: cfg.kind === 'solana' ? 0 : cfg.startBlock - 1,
    transferCount: 0, inboundCount: 0, outboundCount: 0, volumeCents: 0, counterparties: [],
    firstSeenBlock: null, firstSeenAt: null, indexedAt: new Date(0).toISOString(), lastError: null,
  };
}

/** Value in USD cents for a $1 stablecoin with the given decimals; rounds down. */
export function toCents(value: bigint, decimals: number): number {
  const cents = decimals >= 2 ? value / 10n ** BigInt(decimals - 2) : value * 10n ** BigInt(2 - decimals);
  return cents > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(cents);
}

/** Fold one batch of transfers into a summary. Pure; returns the lowest block that qualified. */
export function applyTransfers(
  s: ActivitySummary, wallet: string, token: TokenConfig, transfers: RawTransfer[], limits: IndexerLimits,
): number | null {
  const me = normAddr(wallet);
  const seen = new Set(s.counterparties);
  let lowest: number | null = null;
  for (const t of transfers) {
    const outbound = t.from === me;
    const inbound = t.to === me;
    if (outbound === inbound) continue;                      // neither, or a transfer to oneself
    const other = outbound ? t.to : t.from;
    if (other === ZERO || other === SOLANA_SYSTEM || other === me) continue;   // mint/burn, or oneself
    const cents = toCents(t.value, token.decimals);
    if (cents < limits.dustCents) continue;
    s.transferCount += 1;
    s.volumeCents = Math.min(Number.MAX_SAFE_INTEGER, s.volumeCents + cents);
    if (outbound) s.outboundCount += 1; else s.inboundCount += 1;
    if (!seen.has(other) && seen.size < MAX_COUNTERPARTIES_TRACKED) { seen.add(other); }
    if (lowest === null || t.blockNumber < lowest) lowest = t.blockNumber;
  }
  s.counterparties = [...seen];
  return lowest;
}

// ── Indexing one wallet on one chain ─────────────────────────────────────────

const RANGE_ERROR = /range|limit|too many|exceed|more than|10000|response size/i;

export interface IndexResult { summary: ActivitySummary; advanced: boolean; complete: boolean }

/**
 * Advance a wallet's summary toward the safe head, spending at most `maxCalls`
 * RPC rounds so one new wallet cannot starve the others. Never moves the cursor
 * past a range it failed to read.
 */
export async function indexWallet(
  source: ChainSource, cfg: ChainConfig, wallet: string, prior: ActivitySummary | undefined,
  limits: IndexerLimits = DEFAULT_LIMITS, maxCalls = 25,
): Promise<IndexResult> {
  let s: ActivitySummary = prior ? { ...prior, counterparties: [...prior.counterparties] } : emptySummary(wallet, cfg);
  let advanced = false;
  try {
    const safeHead = (await source.head()) - cfg.confirmations;
    let chunk = cfg.maxBlockRange;
    let calls = 0;
    while (s.cursor < safeHead && calls < maxCalls) {
      const from = s.cursor + 1;
      const to = Math.min(safeHead, from + chunk - 1);
      let batch: Array<{ token: TokenConfig; rows: RawTransfer[] }>;
      try {
        calls += 1;
        batch = await Promise.all(cfg.tokens.map(async (token) => ({ token, rows: await source.transfers(token.address, wallet, from, to) })));
      } catch (e) {
        if (chunk > 1 && RANGE_ERROR.test(String((e as Error).message))) { chunk = Math.max(1, Math.floor(chunk / 2)); continue; }
        throw e;
      }
      // Fold into a copy and commit only when the whole range is done, so a failure
      // part way (including the timestamp lookup) cannot leave a batch counted twice.
      const work: ActivitySummary = { ...s, counterparties: [...s.counterparties] };
      let lowest: number | null = null;
      for (const { token, rows } of batch) {
        const l = applyTransfers(work, wallet, token, rows, limits);
        if (l !== null && (lowest === null || l < lowest)) lowest = l;
      }
      if (lowest !== null && (work.firstSeenBlock === null || lowest < work.firstSeenBlock)) {
        work.firstSeenBlock = lowest;
        work.firstSeenAt = new Date((await source.blockTimestamp(lowest)) * 1000).toISOString();
      }
      work.cursor = to;
      s = work;
      advanced = true;
    }
    s.lastError = null;
    s.indexedAt = new Date().toISOString();
    return { summary: s, advanced, complete: s.cursor >= safeHead };
  } catch (e) {
    // `s` only ever holds fully committed ranges, so what is kept here is consistent with its cursor.
    s.lastError = String((e as Error).message ?? e).slice(0, 200);
    s.indexedAt = new Date().toISOString();
    return { summary: s, advanced, complete: false };
  }
}

// ── Solana ───────────────────────────────────────────────────────────────────

export interface SolanaTokenBalance { accountIndex: number; owner: string; mint: string; amount: bigint }

export interface SolanaTx {
  slot: number;
  blockTime: number | null;
  failed: boolean;
  pre: SolanaTokenBalance[];
  post: SolanaTokenBalance[];
}

export interface SolanaSignature { signature: string; slot: number; blockTime: number | null; failed: boolean }

/** The only part that talks to a Solana RPC node. All reads are at `finalized` commitment. */
export interface SolanaSource {
  tokenAccounts(owner: string, mint: string): Promise<string[]>;
  signatures(account: string, o: { before?: string; until?: string; limit: number }): Promise<SolanaSignature[]>;
  transaction(signature: string): Promise<SolanaTx | null>;
}

export function solanaRpcSource(cfg: SolanaChainConfig): SolanaSource {
  // Errors name the method and the node's own message, never the URL: it carries the provider key.
  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(cfg.rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`solana rpc ${method}: http ${res.status}`);
    const j = (await res.json()) as { result?: T; error?: { message?: string; code?: number } };
    if (j.error) throw new Error(`solana rpc ${method}: ${j.error.message ?? j.error.code}`);
    return j.result as T;
  }
  const commitment = 'finalized';
  const balances = (list: any[] | undefined): SolanaTokenBalance[] =>
    (list ?? []).filter((b) => typeof b?.owner === 'string' && typeof b?.mint === 'string' && typeof b?.uiTokenAmount?.amount === 'string')
      .map((b) => ({ accountIndex: Number(b.accountIndex), owner: b.owner, mint: b.mint, amount: BigInt(b.uiTokenAmount.amount) }));
  return {
    tokenAccounts: async (owner, mint) => {
      const r = await rpc<{ value: Array<{ pubkey: string }> }>('getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed', commitment }]);
      return r.value.map((v) => v.pubkey);
    },
    signatures: async (account, o) => {
      const r = await rpc<Array<{ signature: string; slot: number; blockTime: number | null; err: unknown }>>('getSignaturesForAddress', [
        account, { limit: o.limit, commitment, ...(o.before ? { before: o.before } : {}), ...(o.until ? { until: o.until } : {}) },
      ]);
      return r.map((x) => ({ signature: x.signature, slot: x.slot, blockTime: x.blockTime, failed: x.err != null }));
    },
    transaction: async (signature) => {
      const t = await rpc<any>('getTransaction', [signature, { encoding: 'jsonParsed', commitment, maxSupportedTransactionVersion: 0 }]);
      if (!t) return null;
      return { slot: t.slot, blockTime: t.blockTime ?? null, failed: t.meta?.err != null, pre: balances(t.meta?.preTokenBalances), post: balances(t.meta?.postTokenBalances) };
    },
  };
}

/**
 * What one transaction did to the wallet's balance of one token: its net change, and the other party that moved the opposite
 * way by the most. Returns null when the wallet's balance did not change or there is no counterparty (a mint, a burn, a
 * transfer between the wallet's own accounts), so those never count as activity.
 */
export function classifySolanaTx(tx: SolanaTx, wallet: string, mint: string): RawTransfer | null {
  if (tx.failed) return null;
  const delta = new Map<string, bigint>();
  const add = (list: SolanaTokenBalance[], sign: bigint) => {
    for (const b of list) if (b.mint === mint) delta.set(b.owner, (delta.get(b.owner) ?? 0n) + sign * b.amount);
  };
  add(tx.pre, -1n); add(tx.post, 1n);
  const mine = delta.get(wallet) ?? 0n;
  if (mine === 0n) return null;
  let other: string | null = null; let best = 0n;
  for (const [owner, d] of delta) {
    if (owner === wallet) continue;
    const opposite = mine > 0n ? -d : d;                       // how far this owner moved against the wallet
    if (opposite > best) { best = opposite; other = owner; }
  }
  if (!other) return null;
  const inbound = mine > 0n;
  return { logIndex: 0, blockNumber: tx.slot, from: inbound ? other : wallet, to: inbound ? wallet : other, value: inbound ? mine : -mine };
}

const FRESH_ACCOUNT: SolanaAccountState = { newest: null, pendingNewest: null, fwdBefore: null, before: null, done: false };

/**
 * Advance a wallet's Solana summary. Per token account: first catch up on anything newer than the last signature read, then work
 * back through older history. Each page of signatures is folded into a copy and committed only when every transaction in it has
 * been read, so a failure part way never leaves a page counted twice or skipped. Spends at most `maxCalls` RPC calls.
 *
 * A wallet with more than one token account for the same token is not indexed for that token and says so: counting from several
 * accounts could count one transaction twice, and an undercount is the safer error.
 */
export async function indexSolanaWallet(
  source: SolanaSource, cfg: SolanaChainConfig, wallet: string, prior: ActivitySummary | undefined,
  limits: IndexerLimits = DEFAULT_LIMITS, maxCalls = 300,
): Promise<IndexResult> {
  const clone = (x: ActivitySummary): ActivitySummary => ({
    ...x, counterparties: [...x.counterparties],
    solana: { accounts: Object.fromEntries(Object.entries(x.solana?.accounts ?? {}).map(([k, v]) => [k, { ...v }])) },
  });
  let s = prior ? clone(prior) : { ...emptySummary(wallet, cfg), solana: { accounts: {} } };
  let advanced = false; let complete = true; let calls = 0;
  const notes: string[] = [];
  try {
    for (const token of cfg.tokens) {
      calls += 1;
      const accounts = await source.tokenAccounts(wallet, token.address);
      if (accounts.length === 0) continue;                              // no token account yet: nothing to read
      if (accounts.length > 1) { notes.push(`${token.symbol}: several token accounts, not indexed`); continue; }
      const acct = accounts[0]!;
      let forwardChecked = false;
      for (;;) {
        const st = s.solana!.accounts[acct] ?? { ...FRESH_ACCOUNT };
        const phase: 'init' | 'forward' | 'back' | null =
          st.newest === null ? 'init' : (!forwardChecked || st.pendingNewest !== null) ? 'forward' : !st.done ? 'back' : null;
        if (phase === null) break;
        const limit = Math.min(cfg.pageSize, maxCalls - calls - 1);
        if (limit < 1) { complete = false; break; }
        calls += 1;
        const page = await source.signatures(acct, phase === 'init' ? { limit }
          : phase === 'forward' ? { limit, until: st.newest!, ...(st.fwdBefore ? { before: st.fwdBefore } : {}) }
          : { limit, before: st.before! });

        const work = clone(s);
        const ws: SolanaAccountState = { ...st };
        for (const sig of page) {
          if (sig.failed) continue;
          calls += 1;
          const tx = await source.transaction(sig.signature);
          if (!tx) { work.skipped = (work.skipped ?? 0) + 1; continue; }
          const t = classifySolanaTx(tx, wallet, token.address);
          if (!t) continue;
          const low = applyTransfers(work, wallet, token, [t], limits);
          if (low !== null && tx.blockTime !== null) {
            const at = new Date(tx.blockTime * 1000).toISOString();
            if (work.firstSeenAt === null || at < work.firstSeenAt) { work.firstSeenAt = at; work.firstSeenBlock = tx.slot; }
          }
        }
        const last = page[page.length - 1]?.signature ?? null;
        const full = page.length >= limit;
        if (phase === 'init') {
          ws.newest = page[0]?.signature ?? null; ws.before = last; ws.done = !full || page.length === 0;
          forwardChecked = true;
        } else if (phase === 'forward') {
          if (page.length > 0 && ws.pendingNewest === null) ws.pendingNewest = page[0]!.signature;
          if (full) ws.fwdBefore = last;
          else { if (ws.pendingNewest) ws.newest = ws.pendingNewest; ws.pendingNewest = null; ws.fwdBefore = null; forwardChecked = true; }
        } else {
          ws.before = last ?? ws.before; ws.done = !full;
        }
        work.solana!.accounts[acct] = ws;
        s = work; advanced = true;
      }
    }
    s.lastError = notes[0] ?? null;
    s.indexedAt = new Date().toISOString();
    return { summary: s, advanced, complete: complete && notes.length === 0 };
  } catch (e) {
    s.lastError = String((e as Error).message ?? e).slice(0, 200);
    s.indexedAt = new Date().toISOString();
    return { summary: s, advanced, complete: false };
  }
}

// ── Store, persistence and worker ────────────────────────────────────────────

const summaries = new Map<string, ActivitySummary>();   // `${chainId}:${address}`
const key = (chainId: number, address: string) => `${chainId}:${normAddr(address)}`;

export interface ActivityPersistence { save(s: ActivitySummary): Promise<void> }
let persistence: ActivityPersistence | null = null;
export function setActivityPersistence(p: ActivityPersistence | null): void { persistence = p; }

export function hydrateActivity(rows: ActivitySummary[]): void {
  summaries.clear();
  for (const r of rows) summaries.set(key(r.chainId, r.address), r);
}

export function activityFor(address: string): ActivitySummary[] {
  return [...summaries.values()].filter((s) => s.address === normAddr(address));
}

export function resetActivity(): void { summaries.clear(); }

export interface IndexerDeps {
  chains: AnyChainConfig[];
  sources: Map<number, ChainSource>;
  solanaSources?: Map<number, SolanaSource>;
  listWallets: () => string[];
  limits?: IndexerLimits;
}

let failures = 0;
export function indexerFailureCount(): number { return failures; }

/** One pass over every wallet and chain. Errors on one wallet or chain never stop the others. */
export async function runIndexerPass(deps: IndexerDeps): Promise<void> {
  const limits = deps.limits ?? DEFAULT_LIMITS;
  for (const wallet of deps.listWallets()) {
    for (const cfg of deps.chains) {
      // A wallet is only read on chains of its own kind: a 0x address is not a Solana account, and vice versa.
      const isEvmWallet = /^0x[0-9a-fA-F]{40}$/.test(wallet);
      if (cfg.kind === 'solana' ? !isSolanaAddress(wallet) : !isEvmWallet) continue;
      const prior = summaries.get(key(cfg.chainId, wallet));
      let r: IndexResult;
      if (cfg.kind === 'solana') {
        const src = deps.solanaSources?.get(cfg.chainId);
        if (!src) continue;
        r = await indexSolanaWallet(src, cfg, wallet, prior, limits);
      } else {
        const src = deps.sources.get(cfg.chainId);
        if (!src) continue;
        r = await indexWallet(src, cfg, wallet, prior, limits);
      }
      if (r.summary.lastError) failures += 1;
      summaries.set(key(cfg.chainId, wallet), r.summary);
      if (r.advanced || r.summary.lastError !== (prior?.lastError ?? null)) {
        try { await persistence?.save(r.summary); } catch (e) { failures += 1; console.error('[onchain-activity] could not save summary', (e as Error).message); }
      }
    }
  }
}

let timer: NodeJS.Timeout | null = null;
let running = false;

export function startIndexerWorker(deps: IndexerDeps, intervalMs = 30_000): void {
  if (timer) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    runIndexerPass(deps).catch((e) => console.error('[onchain-activity] pass failed', e)).finally(() => { running = false; });
  }, intervalMs);
  timer.unref();
}

export function stopIndexerWorker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

// ── Scoring input ────────────────────────────────────────────────────────────

export interface ActivityProvenance { chainId: number; name: string; indexedToBlock: number; indexedAt: string; error: string | null }

export type ActivityInputs =
  | { ok: true; totalCount: number; totalVolumeUsd: number; firstSeenAt: string; counterparties: number; provenance: ActivityProvenance[] }
  | { ok: false; reason: 'not_indexed_yet' | 'insufficient_history'; detail: string; provenance: ActivityProvenance[] };

/** Combine the wallet's per-chain summaries into what Mode 2 needs, or say why it cannot be scored. */
/** `address` may be one wallet or several (an agent with both an EVM and a Solana wallet); their activity is combined. */
export function activityInputs(address: string | string[], chains: AnyChainConfig[], limits: IndexerLimits = DEFAULT_LIMITS): ActivityInputs {
  const own = (Array.isArray(address) ? address : [address]).flatMap((a) => activityFor(a));
  const provenance: ActivityProvenance[] = own.map((s) => ({
    chainId: s.chainId, name: chains.find((c) => c.chainId === s.chainId)?.name ?? String(s.chainId),
    indexedToBlock: s.cursor, indexedAt: s.indexedAt, error: s.lastError,
  }));
  if (own.length === 0) {
    return { ok: false, reason: 'not_indexed_yet', detail: 'This wallet has not been read yet; the indexer will pick it up on its next pass.', provenance };
  }
  const counterparties = new Set(own.flatMap((s) => s.counterparties));
  const totalCount = own.reduce((n, s) => n + s.transferCount, 0);
  const firstSeen = own.map((s) => s.firstSeenAt).filter((x): x is string => !!x).sort()[0];
  if (totalCount < limits.minTransfers || counterparties.size < limits.minCounterparties || !firstSeen) {
    return {
      ok: false, reason: 'insufficient_history', provenance,
      detail: `Needs at least ${limits.minTransfers} stablecoin transfers with ${limits.minCounterparties} different counterparties; found ${totalCount} with ${counterparties.size}.`,
    };
  }
  return {
    ok: true, totalCount, totalVolumeUsd: own.reduce((n, s) => n + s.volumeCents, 0) / 100,
    firstSeenAt: firstSeen, counterparties: counterparties.size, provenance,
  };
}
