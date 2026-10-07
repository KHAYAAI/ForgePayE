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

// ── Configuration ────────────────────────────────────────────────────────────

export interface TokenConfig { symbol: string; address: string; decimals: number }

export interface ChainConfig {
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

export function indexerEnabled(): boolean {
  return process.env['ONCHAIN_INDEXER_ENABLED'] === 'true';
}

/**
 * Parse ONCHAIN_CHAINS, a JSON array. There are no built-in token addresses: a
 * wrong address would score the wrong asset without any error, so the operator
 * supplies them from each issuer's published list. Throws with a precise message.
 */
export function parseChains(raw: string | undefined): ChainConfig[] {
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
    const tokens: TokenConfig[] = c.tokens.map((t: any, j: number) => {
      if (typeof t?.symbol !== 'string' || !t.symbol) throw new Error(`${at}.tokens[${j}].symbol is required`);
      if (typeof t?.address !== 'string' || !ADDRESS_RE.test(t.address)) throw new Error(`${at}.tokens[${j}].address is not a valid address`);
      return { symbol: t.symbol, address: t.address.toLowerCase(), decimals: posInt(t.decimals, `tokens[${j}].decimals`, 0) };
    });
    return {
      chainId, name: c.name, rpcUrl: c.rpcUrl, tokens,
      startBlock: posInt(c.startBlock, 'startBlock', 0),
      confirmations: c.confirmations === undefined ? 12 : posInt(c.confirmations, 'confirmations', 0),
      maxBlockRange: c.maxBlockRange === undefined ? 2000 : posInt(c.maxBlockRange, 'maxBlockRange'),
    };
  });
}

let configured: ChainConfig[] = [];
export function setConfiguredChains(c: ChainConfig[]): void { configured = c; }
export function configuredChains(): ChainConfig[] { return configured; }

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
}

export function emptySummary(address: string, cfg: ChainConfig): ActivitySummary {
  return {
    address: address.toLowerCase(), chainId: cfg.chainId, cursor: cfg.startBlock - 1,
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
  const me = wallet.toLowerCase();
  const seen = new Set(s.counterparties);
  let lowest: number | null = null;
  for (const t of transfers) {
    const outbound = t.from === me;
    const inbound = t.to === me;
    if (outbound === inbound) continue;                      // neither, or a transfer to oneself
    const other = outbound ? t.to : t.from;
    if (other === ZERO || other === me) continue;            // mint/burn, or oneself
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

// ── Store, persistence and worker ────────────────────────────────────────────

const summaries = new Map<string, ActivitySummary>();   // `${chainId}:${address}`
const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`;

export interface ActivityPersistence { save(s: ActivitySummary): Promise<void> }
let persistence: ActivityPersistence | null = null;
export function setActivityPersistence(p: ActivityPersistence | null): void { persistence = p; }

export function hydrateActivity(rows: ActivitySummary[]): void {
  summaries.clear();
  for (const r of rows) summaries.set(key(r.chainId, r.address), r);
}

export function activityFor(address: string): ActivitySummary[] {
  return [...summaries.values()].filter((s) => s.address === address.toLowerCase());
}

export function resetActivity(): void { summaries.clear(); }

export interface IndexerDeps {
  chains: ChainConfig[];
  sources: Map<number, ChainSource>;
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
      const source = deps.sources.get(cfg.chainId);
      if (!source) continue;
      const prior = summaries.get(key(cfg.chainId, wallet));
      const r = await indexWallet(source, cfg, wallet, prior, limits);
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
export function activityInputs(address: string, chains: ChainConfig[], limits: IndexerLimits = DEFAULT_LIMITS): ActivityInputs {
  const own = activityFor(address);
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
