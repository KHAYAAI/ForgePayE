/**
 * Solana activity indexing. A fake node pages signatures newest-first (with `before`/`until`) the way a real one does, so paging,
 * catch-up on new activity, resumption and atomic page commits are exercised without a network.
 */
import { generateKeyPairSync } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  activityFor, activityInputs, classifySolanaTx, DEFAULT_LIMITS, hydrateActivity, indexSolanaWallet, parseChains, resetActivity,
  runIndexerPass, setActivityPersistence, type ChainSource, type SolanaChainConfig, type SolanaSource, type SolanaTx,
} from './onchain-activity';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)]! + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = '1' + out; else break; }
  return out;
}
const fresh = () => {
  const spki = generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' });
  return base58Encode(new Uint8Array(spki.subarray(spki.length - 32)));
};

const WALLET = fresh(); const MINT = fresh(); const OTHER_MINT = fresh(); const ACCT = fresh();
const CP = Array.from({ length: 12 }, () => fresh());
const CFG: SolanaChainConfig = { kind: 'solana', chainId: 101, name: 'Solana', rpcUrl: 'https://rpc.example.org', pageSize: 2, tokens: [{ symbol: 'USDC', address: MINT, decimals: 6 }] };
const usd = (n: number) => BigInt(Math.round(n * 1e6));

interface FakeTx { sig: string; slot: number; time: number | null; failed?: boolean; missing?: boolean; moves: Array<[string, number, string?]> }
const T0 = 1_700_000_000;
/** Wallet receives `dollars` from `from`. */
const inTx = (n: number, from: string, dollars: number): FakeTx => ({ sig: `s${n}`, slot: 100 + n, time: T0 + n * 100, moves: [[WALLET, dollars], [from, -dollars]] });
const outTx = (n: number, to: string, dollars: number): FakeTx => ({ sig: `s${n}`, slot: 100 + n, time: T0 + n * 100, moves: [[WALLET, -dollars], [to, dollars]] });

function toTx(t: FakeTx): SolanaTx {
  const pre: SolanaTx['pre'] = []; const post: SolanaTx['post'] = [];
  t.moves.forEach(([owner, d, mint], i) => {
    const m = mint ?? MINT;
    if (d < 0) pre.push({ accountIndex: i, owner, mint: m, amount: usd(-d) }); else post.push({ accountIndex: i, owner, mint: m, amount: usd(d) });
  });
  return { slot: t.slot, blockTime: t.time, failed: !!t.failed, pre, post };
}

/** `txs` is newest first and may be mutated by a test to simulate new activity. */
function fakeNode(txs: FakeTx[], o: { accounts?: string[]; failOnTx?: (sig: string) => boolean } = {}) {
  const log = { sigCalls: [] as Array<{ before?: string; until?: string; limit: number }>, txCalls: [] as string[], accountCalls: [] as string[] };
  const source: SolanaSource = {
    tokenAccounts: async (owner) => { log.accountCalls.push(owner); return o.accounts ?? [ACCT]; },
    signatures: async (_a, q) => {
      log.sigCalls.push(q);
      let list = txs;
      if (q.before) list = list.slice(list.findIndex((t) => t.sig === q.before) + 1);
      if (q.until) { const i = list.findIndex((t) => t.sig === q.until); if (i >= 0) list = list.slice(0, i); }
      return list.slice(0, q.limit).map((t) => ({ signature: t.sig, slot: t.slot, blockTime: t.time, failed: !!t.failed }));
    },
    transaction: async (sig) => {
      log.txCalls.push(sig);
      if (o.failOnTx?.(sig)) throw new Error('rpc 502');
      const t = txs.find((x) => x.sig === sig)!;
      return t.missing ? null : toTx(t);
    },
  };
  return { source, log, txs };
}

beforeEach(() => { resetActivity(); setActivityPersistence(null); });

describe('classifying a transaction', () => {
  const tx = (moves: FakeTx['moves'], failed = false) => toTx({ sig: 'x', slot: 7, time: T0, failed, moves });
  it('reads the wallet\'s net change and the party that moved against it by the most', () => {
    const inbound = classifySolanaTx(tx([[WALLET, 10], [CP[0]!, -4], [CP[1]!, -6]]), WALLET, MINT)!;
    expect(inbound).toMatchObject({ from: CP[1], to: WALLET, value: usd(10), blockNumber: 7 });
    const outbound = classifySolanaTx(tx([[WALLET, -25], [CP[2]!, 25]]), WALLET, MINT)!;
    expect(outbound).toMatchObject({ from: WALLET, to: CP[2], value: usd(25) });
  });
  it('is not activity when the wallet did not move, the tx failed, or nobody moved against it (a mint or burn)', () => {
    expect(classifySolanaTx(tx([[CP[0]!, 5], [CP[1]!, -5]]), WALLET, MINT)).toBeNull();
    expect(classifySolanaTx(tx([[WALLET, 5], [CP[1]!, -5]], true), WALLET, MINT)).toBeNull();
    expect(classifySolanaTx(tx([[WALLET, 5]]), WALLET, MINT)).toBeNull();                        // mint
    expect(classifySolanaTx(tx([[WALLET, -5]]), WALLET, MINT)).toBeNull();                       // burn
    expect(classifySolanaTx(tx([[WALLET, 5], [WALLET, -5]]), WALLET, MINT)).toBeNull();          // between its own accounts: net zero
  });
  it('ignores other tokens in the same transaction', () => {
    expect(classifySolanaTx(tx([[WALLET, 5, OTHER_MINT], [CP[1]!, -5, OTHER_MINT]]), WALLET, MINT)).toBeNull();
  });
});

describe('configuration', () => {
  const sol = { kind: 'solana', chainId: 101, name: 'Solana', rpcUrl: 'https://rpc.example.org', tokens: [{ symbol: 'USDC', address: MINT, decimals: 6 }] };
  it('accepts a Solana cluster next to an EVM chain, keeping the mint\'s case and defaulting the page size', () => {
    const evm = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.example.org', startBlock: 1, tokens: [{ symbol: 'USDC', address: '0x' + 'a'.repeat(40), decimals: 6 }] };
    const [a, b] = parseChains(JSON.stringify([evm, sol]));
    expect(a!.kind).toBeUndefined();
    expect(b).toMatchObject({ kind: 'solana', chainId: 101, pageSize: 50 });
    expect(b!.tokens[0]!.address).toBe(MINT);
  });
  it('refuses an EVM address as a Solana mint, a bad kind, and a chain id used twice', () => {
    expect(() => parseChains(JSON.stringify([{ ...sol, tokens: [{ symbol: 'X', address: '0x' + 'a'.repeat(40), decimals: 6 }] }]))).toThrow(/Solana mint/);
    expect(() => parseChains(JSON.stringify([{ ...sol, kind: 'cosmos' }]))).toThrow(/kind/);
    expect(() => parseChains(JSON.stringify([sol, sol]))).toThrow(/twice/);
  });
});

describe('indexing a Solana wallet', () => {
  it('counts activity in both directions, ignores dust, and records the earliest time', async () => {
    const node = fakeNode([outTx(3, CP[2]!, 4), inTx(2, CP[1]!, 0.001), inTx(1, CP[0]!, 10)].map((t, i) => (i === 1 ? { ...t, slot: 102 } : t)));
    const r = await indexSolanaWallet(node.source, { ...CFG, pageSize: 10 }, WALLET, undefined);
    expect(r.summary).toMatchObject({ transferCount: 2, inboundCount: 1, outboundCount: 1, volumeCents: 1400, lastError: null });
    expect(r.summary.firstSeenAt).toBe(new Date((T0 + 100) * 1000).toISOString());
    expect(r.summary.firstSeenBlock).toBe(101);
    expect(r.complete).toBe(true);
  });

  it('works back through history across several passes, counting each transaction once', async () => {
    const node = fakeNode([inTx(5, CP[4]!, 5), inTx(4, CP[3]!, 5), inTx(3, CP[2]!, 5), inTx(2, CP[1]!, 5), inTx(1, CP[0]!, 5)]);
    const first = await indexSolanaWallet(node.source, CFG, WALLET, undefined, DEFAULT_LIMITS, 4);   // enough for one page only
    expect(first.complete).toBe(false);
    expect(first.summary.transferCount).toBe(2);
    const done = await indexSolanaWallet(node.source, CFG, WALLET, first.summary, DEFAULT_LIMITS, 300);
    expect(done.summary.transferCount).toBe(5);
    expect(done.summary.volumeCents).toBe(2500);
    expect(done.complete).toBe(true);
    expect(new Set(node.log.txCalls).size).toBe(node.log.txCalls.length);                                 // no transaction fetched twice
    const again = await indexSolanaWallet(node.source, CFG, WALLET, done.summary, DEFAULT_LIMITS, 300);
    expect(again.summary.transferCount).toBe(5);
  });

  it('catches up on new activity, even when it spans more than one page, without recounting old transactions', async () => {
    const node = fakeNode([inTx(2, CP[1]!, 5), inTx(1, CP[0]!, 5)]);
    const base = await indexSolanaWallet(node.source, CFG, WALLET, undefined);
    expect(base.summary.transferCount).toBe(2);
    node.txs.unshift(inTx(5, CP[4]!, 7), inTx(4, CP[3]!, 7), inTx(3, CP[2]!, 7));                       // newer than anything read, 3 > pageSize 2
    node.log.txCalls.length = 0;
    const next = await indexSolanaWallet(node.source, CFG, WALLET, base.summary);
    expect(next.summary).toMatchObject({ transferCount: 5, volumeCents: 2 * 500 + 3 * 700 });
    expect(node.log.txCalls.sort()).toEqual(['s3', 's4', 's5']);                                          // only the new ones were fetched
  });

  it('resumes an interrupted catch-up without counting the committed page again or skipping the rest', async () => {
    const node = fakeNode([inTx(2, CP[1]!, 5), inTx(1, CP[0]!, 5)]);
    const base = await indexSolanaWallet(node.source, CFG, WALLET, undefined);
    node.txs.unshift(inTx(5, CP[4]!, 7), inTx(4, CP[3]!, 7), inTx(3, CP[2]!, 7));
    let failing = true;
    const failNode = fakeNode(node.txs, { failOnTx: (sig) => failing && sig === 's3' });                  // the second page fails on s3
    const broken = await indexSolanaWallet(failNode.source, CFG, WALLET, base.summary);
    expect(broken.summary.lastError).toBe('rpc 502');
    expect(broken.summary.transferCount).toBe(4);                                                         // page one (s5, s4) was committed
    failing = false;
    const fixed = await indexSolanaWallet(failNode.source, CFG, WALLET, broken.summary);
    expect(fixed.summary).toMatchObject({ transferCount: 5, lastError: null });
    const settled = await indexSolanaWallet(failNode.source, CFG, WALLET, fixed.summary);
    expect(settled.summary.transferCount).toBe(5);
  });

  it('commits a page only when every transaction in it was read, so a failure cannot leave it half counted', async () => {
    let failing = true;
    const node = fakeNode([inTx(2, CP[1]!, 5), inTx(1, CP[0]!, 5)], { failOnTx: (sig) => failing && sig === 's1' });
    const bad = await indexSolanaWallet(node.source, CFG, WALLET, undefined);
    expect(bad.summary.transferCount).toBe(0);                                                            // s2 was read but the page did not commit
    expect(bad.summary.solana!.accounts[ACCT]).toBeUndefined();
    failing = false;
    const good = await indexSolanaWallet(node.source, CFG, WALLET, bad.summary);
    expect(good.summary.transferCount).toBe(2);                                                           // each counted exactly once
  });

  it('counts a transaction the node can no longer return as skipped, and carries on', async () => {
    const node = fakeNode([inTx(2, CP[1]!, 5), { ...inTx(1, CP[0]!, 5), missing: true }]);
    const r = await indexSolanaWallet(node.source, CFG, WALLET, undefined);
    expect(r.summary).toMatchObject({ transferCount: 1, skipped: 1 });
  });

  it('does nothing, without error, for a wallet with no token account yet', async () => {
    const node = fakeNode([], { accounts: [] });
    const r = await indexSolanaWallet(node.source, CFG, WALLET, undefined);
    expect(r.summary).toMatchObject({ transferCount: 0, lastError: null });
    expect(node.log.sigCalls).toHaveLength(0);
  });

  it('refuses to count from several token accounts for one token, and says so', async () => {
    const node = fakeNode([inTx(1, CP[0]!, 5)], { accounts: [ACCT, fresh()] });
    const r = await indexSolanaWallet(node.source, CFG, WALLET, undefined);
    expect(r.summary.transferCount).toBe(0);
    expect(r.summary.lastError).toMatch(/several token accounts/);
    expect(node.log.sigCalls).toHaveLength(0);
  });

  it('spends a bounded number of calls, so a busy wallet cannot starve the others', async () => {
    const many = Array.from({ length: 40 }, (_, i) => inTx(40 - i, CP[i % CP.length]!, 5));
    const node = fakeNode(many);
    const r = await indexSolanaWallet(node.source, { ...CFG, pageSize: 50 }, WALLET, undefined, DEFAULT_LIMITS, 10);
    expect(node.log.sigCalls.length + node.log.txCalls.length + node.log.accountCalls.length).toBeLessThanOrEqual(10);
    expect(r.complete).toBe(false);
  });
});

describe('a pass over mixed wallets', () => {
  const EVM_WALLET = '0x' + '1'.repeat(40);
  it('sends each wallet only to chains of its own kind, and keeps the Solana address\'s case', async () => {
    const node = fakeNode([inTx(2, CP[1]!, 5), inTx(1, CP[0]!, 5)]);
    const evmSeen: string[] = [];
    const evm: ChainSource = { head: async () => 0, blockTimestamp: async () => 0, transfers: async (_t, w) => { evmSeen.push(w); return []; } };
    const evmCfg = { chainId: 8453, name: 'Base', rpcUrl: 'https://rpc.example.org', startBlock: 1, confirmations: 0, maxBlockRange: 10, tokens: [{ symbol: 'USDC', address: '0x' + 'a'.repeat(40), decimals: 6 }] };
    await runIndexerPass({ chains: [evmCfg, CFG], sources: new Map([[8453, evm]]), solanaSources: new Map([[101, node.source]]), listWallets: () => [EVM_WALLET, WALLET] });
    expect(evmSeen.every((w) => w === EVM_WALLET)).toBe(true);
    expect(node.log.accountCalls).toEqual([WALLET]);
    expect(activityFor(WALLET)).toHaveLength(1);
    expect(activityFor(WALLET)[0]!.address).toBe(WALLET);
    expect(activityFor(WALLET.toLowerCase())).toHaveLength(0);                                            // base58 is case-sensitive
  });

  it('combines an agent\'s EVM and Solana activity into one Mode 2 input', () => {
    hydrateActivity([
      { address: EVM_WALLET, chainId: 8453, cursor: 9, transferCount: 3, inboundCount: 3, outboundCount: 0, volumeCents: 3000, counterparties: ['0x' + '2'.repeat(40), '0x' + '3'.repeat(40)], firstSeenBlock: 1, firstSeenAt: '2026-03-01T00:00:00.000Z', indexedAt: '2026-10-07T00:00:00.000Z', lastError: null },
      { address: WALLET, chainId: 101, cursor: 0, transferCount: 4, inboundCount: 2, outboundCount: 2, volumeCents: 5000, counterparties: [CP[0]!, CP[1]!], firstSeenBlock: 5, firstSeenAt: '2026-02-01T00:00:00.000Z', indexedAt: '2026-10-07T00:00:00.000Z', lastError: null },
    ]);
    const r = activityInputs([EVM_WALLET, WALLET], [
      { chainId: 8453, name: 'Base', rpcUrl: 'x', startBlock: 1, confirmations: 1, maxBlockRange: 1, tokens: [] }, CFG,
    ]);
    expect(r).toMatchObject({ ok: true, totalCount: 7, totalVolumeUsd: 80, counterparties: 4, firstSeenAt: '2026-02-01T00:00:00.000Z' });
    if (r.ok) expect(r.provenance.map((p) => p.name).sort()).toEqual(['Base', 'Solana']);
  });
});
