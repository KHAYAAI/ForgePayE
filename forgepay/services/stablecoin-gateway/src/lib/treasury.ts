/**
 * Keeping the payout wallet funded, without a person moving money by hand and without
 * any one wallet holding everything.
 *
 * Money moves through three tiers:
 *
 *   deposit addresses --sweep--> OPERATING wallet --top-up--> PAYOUT wallet (hot)
 *                                      |
 *                                      +--surplus--> COLD address (fixed, one-way)
 *
 *   - The payout wallet is the hot key the payout signer uses. It holds only what the
 *     next payouts need: when a token falls below a floor, the operating wallet sends it
 *     up to a target. The floor is the larger of a configured minimum and what approved
 *     payouts already waiting need, so a payout never fails for lack of funds that exist.
 *   - The operating wallet is where sweeps land. It is a hot key too, so it is limited:
 *     a daily cap on how much it will send to the payout wallet, its destination fixed to
 *     that one address, and a ceiling above which the surplus goes to cold storage.
 *   - Cold storage is an address only — this service holds no key for it, and nothing
 *     here can move money out of it. Whoever controls it (custody, a hardware wallet) does.
 *
 * So a compromise of the gateway exposes at most the payout wallet's float plus the
 * operating wallet's ceiling, not the treasury.
 *
 * When the operating wallet cannot cover what the payout wallet needs, or the daily cap is
 * reached, that is a *shortfall*: recorded, reported at GET /treasury/status, and emitted
 * as an event. It is never papered over by raising limits automatically.
 *
 * Every transfer is written to `treasury_transfers` before it is sent and gets its hash
 * the moment it is. A pass begins by settling any left open from the chain, and will not
 * start a second transfer of the same asset while one is unresolved.
 */

import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AssetRegistry, ChainAsset } from './assets.js';
import type { Queryable } from './deposit-open.js';
import { quoteFor, type RateStore } from './fx.js';
import { usdToMicro, usdMicroToUnits, RATE_SCALE } from './asset-math.js';

const ERC20 = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

// ── Configuration ─────────────────────────────────────────────────────────────

export interface TreasuryConfig {
  chain: string;
  chainId?: number;
  warmKey: string;
  assets: string[];
  lowUsd: number;
  targetUsd: number;
  dailyMaxUsd: number;
  gasLowWei: bigint;
  gasTargetWei: bigint;
  warmMaxUsd: number;
  warmTargetUsd: number;
  cold?: string;
  confirmations: number;
  /** Consider a transfer that has had no outcome this long unresolved-and-blocking (ms). */
  openTransferBlockMs: number;
}

export class TreasuryConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'TreasuryConfigError'; }
}

export function treasuryRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['TREASURY_MANAGER_ENABLED'] === 'true';
}

export function resolveTreasuryConfig(env: NodeJS.ProcessEnv = process.env, payoutAddress?: string): TreasuryConfig {
  const prod = env['NODE_ENV'] === 'production';
  if (!payoutAddress) throw new TreasuryConfigError('TREASURY_MANAGER_ENABLED needs a live payout signer (PAYOUT_SIGNER_ENABLED=true): the payout wallet is what it tops up.');

  let key = env['TREASURY_WARM_PRIVATE_KEY']?.trim();
  if (env['TREASURY_WARM_KEY_FILE']) {
    try { key = readFileSync(env['TREASURY_WARM_KEY_FILE'], 'utf8').trim(); }
    catch (e) { throw new TreasuryConfigError(`TREASURY_WARM_KEY_FILE could not be read: ${(e as Error).message}`); }
  }
  if (!key) throw new TreasuryConfigError('no operating-wallet key is set (TREASURY_WARM_KEY_FILE preferred, or TREASURY_WARM_PRIVATE_KEY).');
  let warmAddress: string;
  try { warmAddress = new ethers.Wallet(key).address; } catch { throw new TreasuryConfigError('the operating-wallet key is not a valid private key (details withheld).'); }
  if (warmAddress.toLowerCase() === payoutAddress.toLowerCase()) {
    throw new TreasuryConfigError('the operating wallet and the payout wallet are the same key; the tiers only protect anything if they are different.');
  }

  const num = (k: string, d: number) => { const n = Number(env[k] ?? d); if (!Number.isFinite(n) || n < 0) throw new TreasuryConfigError(`${k} must be a non-negative number`); return n; };
  const wei = (k: string, d: string) => { try { return BigInt(env[k] ?? d); } catch { throw new TreasuryConfigError(`${k} must be a whole number of wei`); } };
  const cfg: TreasuryConfig = {
    chain: env['TREASURY_CHAIN'] ?? 'base',
    warmKey: key,
    assets: (env['TREASURY_ASSETS'] ?? 'USDC,ZARP,OUSD').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    lowUsd: num('REPLENISH_LOW_USD', 500),
    targetUsd: num('REPLENISH_TARGET_USD', 2000),
    dailyMaxUsd: num('REPLENISH_DAILY_MAX_USD', 10_000),
    gasLowWei: wei('REPLENISH_GAS_LOW_WEI', '5000000000000000'),
    gasTargetWei: wei('REPLENISH_GAS_TARGET_WEI', '20000000000000000'),
    warmMaxUsd: num('TREASURY_WARM_MAX_USD', 25_000),
    warmTargetUsd: num('TREASURY_WARM_TARGET_USD', 5_000),
    confirmations: Math.max(1, num('TREASURY_CONFIRMATIONS', 1)),
    openTransferBlockMs: num('TREASURY_OPEN_BLOCK_MS', 600_000),
  };
  if (cfg.targetUsd <= cfg.lowUsd) throw new TreasuryConfigError('REPLENISH_TARGET_USD must be above REPLENISH_LOW_USD.');
  if (cfg.warmTargetUsd >= cfg.warmMaxUsd) throw new TreasuryConfigError('TREASURY_WARM_TARGET_USD must be below TREASURY_WARM_MAX_USD.');
  if (cfg.gasTargetWei <= cfg.gasLowWei) throw new TreasuryConfigError('REPLENISH_GAS_TARGET_WEI must be above REPLENISH_GAS_LOW_WEI.');

  const cold = env['TREASURY_COLD_ADDRESS'];
  if (cold) {
    if (!ethers.isAddress(cold) || /^0x0{40}$/i.test(cold)) throw new TreasuryConfigError('TREASURY_COLD_ADDRESS is not a usable address.');
    cfg.cold = ethers.getAddress(cold.toLowerCase());
    if ([warmAddress, payoutAddress].some((a) => a.toLowerCase() === cfg.cold!.toLowerCase())) {
      throw new TreasuryConfigError('the cold address must be different from the operating and payout wallets.');
    }
  }
  if (env['TREASURY_CHAIN_ID']) {
    if (prod) throw new TreasuryConfigError('TREASURY_CHAIN_ID may not be set in production.');
    cfg.chainId = Number(env['TREASURY_CHAIN_ID']);
  }
  return cfg;
}

// ── Decisions (pure, tested directly) ─────────────────────────────────────────

export interface ReplenishInput {
  balance: bigint;          // payout wallet's balance of the token
  lowUnits: bigint;         // the configured minimum
  targetUnits: bigint;      // what to refill to
  approvedQueueUnits: bigint; // approved payouts waiting to be sent
  warmBalance: bigint;      // what the operating wallet holds
  capLeftUnits: bigint;     // what the daily cap still allows
}
export interface ReplenishPlan { send: bigint; shortfall: bigint }

export function planReplenishment(i: ReplenishInput): ReplenishPlan {
  const floor = i.lowUnits > i.approvedQueueUnits ? i.lowUnits : i.approvedQueueUnits;
  if (i.balance >= floor) return { send: 0n, shortfall: 0n };
  const want = i.targetUnits > i.approvedQueueUnits + i.lowUnits ? i.targetUnits : i.approvedQueueUnits + i.lowUnits;
  let send = want - i.balance;
  if (send > i.warmBalance) send = i.warmBalance;
  if (send > i.capLeftUnits) send = i.capLeftUnits;
  if (send < 0n) send = 0n;
  const mustHave = floor - i.balance; // the least that would make the wallet adequate
  return { send, shortfall: mustHave > send ? mustHave - send : 0n };
}

/** Surplus in the operating wallet to hand on to cold storage. */
export function planColdSweep(warmBalance: bigint, maxUnits: bigint, targetUnits: bigint): bigint {
  return warmBalance > maxUnits ? warmBalance - targetUnits : 0n;
}

/** A token amount's value in micro-dollars at the given rate (asset units per USD, scaled 1e8). */
export function unitsToUsdMicro(units: bigint, decimals: number, assetPerUsd: bigint): bigint {
  return (units * 1_000_000n * RATE_SCALE) / (10n ** BigInt(decimals) * assetPerUsd);
}

// ── The manager ───────────────────────────────────────────────────────────────

export interface TreasuryDeps {
  provider(chain: string): ethers.JsonRpcProvider;
}

export interface AssetStatus {
  asset: string; decimals: number;
  payout_units: string; payout_usd: number; approved_queue_units: string; below_floor: boolean;
  warm_units: string; warm_usd: number;
}
export interface Shortfall { asset: string; short_units: string; short_usd: number; reason: string }
export interface TreasuryStatus {
  chain: string; payout_wallet: string; operating_wallet: string; cold_address: string | null;
  payout_native_wei: string; warm_native_wei: string; warm_gas_low: boolean;
  assets: AssetStatus[]; shortfalls: Shortfall[];
  daily_cap_usd: number; used_24h_usd: number;
}

export class TreasuryManager {
  private chainLock: Promise<unknown> = Promise.resolve();
  readonly warm: ethers.Wallet;

  constructor(
    private readonly db: Queryable, private readonly registry: AssetRegistry, private readonly rates: RateStore,
    private readonly cfg: TreasuryConfig, private readonly payoutAddress: string, private readonly deps: TreasuryDeps,
    private readonly emit: (type: string, detail: unknown) => Promise<void> = async () => undefined,
  ) {
    this.warm = new ethers.Wallet(cfg.warmKey, deps.provider(cfg.chain));
  }

  runOnce(): Promise<{ sent: number; shortfalls: Shortfall[] }> {
    const run = this.chainLock.then(() => this.pass(), () => this.pass());
    this.chainLock = run.catch(() => undefined);
    return run;
  }

  private provider() { return this.deps.provider(this.cfg.chain); }

  private usable(): ChainAsset[] {
    return this.cfg.assets.map((s) => this.registry.get(s, this.cfg.chain)).filter((a): a is ChainAsset => !!a);
  }

  private async usdToUnits(asset: ChainAsset, usd: number): Promise<bigint> {
    const q = await quoteFor(asset.symbol, asset.unit, this.rates);
    return usdMicroToUnits(usdToMicro(usd), q.assetPerUsd, asset.decimals, 'floor');
  }
  private async unitsToUsd(asset: ChainAsset, units: bigint): Promise<number> {
    const q = await quoteFor(asset.symbol, asset.unit, this.rates);
    return Number(unitsToUsdMicro(units, asset.decimals, q.assetPerUsd)) / 1e6;
  }

  private async pass(): Promise<{ sent: number; shortfalls: Shortfall[] }> {
    let sent = 0;
    const shortfalls: Shortfall[] = [];
    await this.reconcile();
    const provider = this.provider();

    // 1. Native coin for the payout wallet: it pays gas on every payout and the signer refuses to send with none.
    try {
      const have = await provider.getBalance(this.payoutAddress);
      if (have < this.cfg.gasLowWei) {
        const need = this.cfg.gasTargetWei - have;
        const warmNative = await provider.getBalance(this.warm.address);
        if (await this.hasOpen('NATIVE')) { /* one already on its way */ }
        else if (warmNative > need) { if (await this.send('replenish_gas', 'NATIVE', need, 0n, null)) sent++; }
        else shortfalls.push({ asset: 'NATIVE', short_units: (need - warmNative).toString(), short_usd: 0, reason: 'the operating wallet has too little native coin to fund the payout wallet\'s gas' });
      }
    } catch (err) { console.error('[treasury] gas check failed:', err instanceof Error ? err.message : err); }

    for (const asset of this.usable()) {
      try {
        const token = new ethers.Contract(asset.address, ERC20, provider);
        const balance = (await token['balanceOf']!(this.payoutAddress)) as bigint;
        const warmBal = (await token['balanceOf']!(this.warm.address)) as bigint;
        const approved = await this.approvedQueue(asset.symbol);
        const low = await this.usdToUnits(asset, this.cfg.lowUsd);
        const target = await this.usdToUnits(asset, this.cfg.targetUsd);
        const used = await this.usedUsd24h();
        const capLeftUsd = Math.max(0, this.cfg.dailyMaxUsd - used);
        const capLeft = await this.usdToUnits(asset, capLeftUsd);

        const plan = planReplenishment({ balance, lowUnits: low, targetUnits: target, approvedQueueUnits: approved, warmBalance: warmBal, capLeftUnits: capLeft });
        if (plan.send > 0n && !(await this.hasOpen(asset.symbol))) {
          const usdMicro = await this.unitsToUsd(asset, plan.send).then((u) => BigInt(Math.round(u * 1e6)));
          if (await this.send('replenish', asset.symbol, plan.send, usdMicro, asset)) sent++;
        }
        if (plan.shortfall > 0n) {
          const why = warmBal < plan.shortfall ? 'the operating wallet does not hold enough' : 'the daily replenishment cap has been reached';
          shortfalls.push({ asset: asset.symbol, short_units: plan.shortfall.toString(), short_usd: await this.unitsToUsd(asset, plan.shortfall), reason: why });
        }

        // Surplus to cold storage.
        if (this.cfg.cold) {
          const max = await this.usdToUnits(asset, this.cfg.warmMaxUsd);
          const tgt = await this.usdToUnits(asset, this.cfg.warmTargetUsd);
          const after = warmBal - (plan.send > 0n ? plan.send : 0n);
          const excess = planColdSweep(after, max, tgt);
          if (excess > 0n && !(await this.hasOpen(asset.symbol, 'cold_sweep'))) {
            const usdMicro = await this.unitsToUsd(asset, excess).then((u) => BigInt(Math.round(u * 1e6)));
            if (await this.send('cold_sweep', asset.symbol, excess, usdMicro, asset)) sent++;
          }
        }
      } catch (err) {
        console.error(`[treasury] ${asset.symbol} pass failed:`, err instanceof Error ? err.message : err);
      }
    }
    await this.record(shortfalls);
    return { sent, shortfalls };
  }

  /**
   * Approved payouts not yet sent. Only these: once a payout has been sent its tokens have already
   * left the wallet, so counting it again would top the wallet up twice for the same payment.
   */
  private async approvedQueue(symbol: string): Promise<bigint> {
    const r = await this.db.query(`SELECT COALESCE(SUM(amount_units::numeric), 0)::text AS n FROM payouts WHERE asset = $1 AND status = 'approved'`, [symbol]);
    return BigInt(String(r.rows[0].n).split('.')[0]);
  }

  private async usedUsd24h(): Promise<number> {
    const r = await this.db.query(`SELECT COALESCE(SUM(usd_micro), 0)::text AS n FROM treasury_transfers WHERE kind = 'replenish' AND status IN ('planned','sent','confirmed') AND created_at > NOW() - INTERVAL '24 hours'`);
    return Number(r.rows[0].n) / 1e6;
  }

  private async hasOpen(asset: string, kind?: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM treasury_transfers WHERE asset = $1 AND status IN ('planned','sent') ${kind ? 'AND kind = $3' : `AND kind <> 'cold_sweep'`} AND created_at > NOW() - ($2 * INTERVAL '1 millisecond') LIMIT 1`,
      kind ? [asset, this.cfg.openTransferBlockMs, kind] : [asset, this.cfg.openTransferBlockMs]);
    return r.rows.length > 0;
  }

  /** Write the row, send, record the hash at once, then wait. Returns whether a transfer went out. */
  private async send(kind: 'replenish' | 'replenish_gas' | 'cold_sweep', assetSymbol: string, units: bigint, usdMicro: bigint, asset: ChainAsset | null): Promise<boolean> {
    const to = kind === 'cold_sweep' ? this.cfg.cold! : this.payoutAddress;
    const id = randomUUID();
    await this.db.query(
      `INSERT INTO treasury_transfers (id, kind, chain, asset, from_address, to_address, units, usd_micro) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, kind, this.cfg.chain, assetSymbol, this.warm.address, to, units.toString(), usdMicro.toString()]);
    let tx: ethers.TransactionResponse;
    try {
      tx = asset
        ? await (new ethers.Contract(asset.address, ERC20, this.warm) as ethers.Contract)['transfer']!(to, units)
        : await this.warm.sendTransaction({ to, value: units });
    } catch (err) {
      // Nothing was sent: safe to record and move on.
      await this.db.query(`UPDATE treasury_transfers SET status='failed', error=$2, updated_at=NOW() WHERE id=$1`, [id, err instanceof Error ? err.message : String(err)]);
      console.error(`[treasury] ${kind} of ${units} ${assetSymbol} could not be sent:`, err instanceof Error ? err.message : err);
      return false;
    }
    await this.db.query(`UPDATE treasury_transfers SET status='sent', tx=$2, updated_at=NOW() WHERE id=$1`, [id, tx.hash]);
    try {
      const receipt = await tx.wait(this.cfg.confirmations);
      const ok = !!receipt && receipt.status === 1;
      await this.db.query(`UPDATE treasury_transfers SET status=$2, error=$3, updated_at=NOW() WHERE id=$1`, [id, ok ? 'confirmed' : 'failed', ok ? null : `transaction ${tx.hash} reverted`]);
    } catch { /* stays 'sent'; the next pass settles it from the chain */ }
    return true;
  }

  /** Settle transfers left open by a crash or a slow chain, from what the chain says. */
  private async reconcile(): Promise<void> {
    const open = await this.db.query(`SELECT * FROM treasury_transfers WHERE status IN ('planned','sent') ORDER BY created_at`);
    for (const t of open.rows) {
      try {
        if (!t.tx) {
          if (Date.now() - new Date(t.updated_at).getTime() > 120_000) {
            await this.db.query(`UPDATE treasury_transfers SET status='failed', error='interrupted before a transaction was recorded; it may or may not have been sent. Check the operating wallet before assuming either.', updated_at=NOW() WHERE id=$1 AND status='planned'`, [t.id]);
          }
          continue;
        }
        const receipt = await this.provider().getTransactionReceipt(t.tx);
        if (!receipt) continue;
        await this.db.query(`UPDATE treasury_transfers SET status=$2, error=$3, updated_at=NOW() WHERE id=$1 AND status='sent'`, [t.id, receipt.status === 1 ? 'confirmed' : 'failed', receipt.status === 1 ? null : `transaction ${t.tx} reverted`]);
      } catch (err) { console.error('[treasury] could not reconcile a transfer:', err instanceof Error ? err.message : err); }
    }
  }

  private async record(shortfalls: Shortfall[]): Promise<void> {
    const prev = (await this.db.query(`SELECT value FROM treasury_state WHERE key = 'shortfalls'`)).rows[0]?.value as Shortfall[] | undefined;
    const sig = (s: Shortfall[]) => JSON.stringify(s.map((x) => `${x.asset}:${x.reason}`).sort());
    await this.db.query(
      `INSERT INTO treasury_state (key, value) VALUES ('shortfalls', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(shortfalls)]);
    if (sig(shortfalls) !== sig(prev ?? [])) {
      await this.emit(shortfalls.length ? 'treasury.shortfall' : 'treasury.shortfall_cleared', shortfalls).catch(() => undefined);
      if (shortfalls.length) console.warn('[treasury] SHORTFALL:', JSON.stringify(shortfalls));
    }
  }

  async status(): Promise<TreasuryStatus> {
    const provider = this.provider();
    const assets: AssetStatus[] = [];
    for (const a of this.usable()) {
      const token = new ethers.Contract(a.address, ERC20, provider);
      const p = (await token['balanceOf']!(this.payoutAddress)) as bigint;
      const w = (await token['balanceOf']!(this.warm.address)) as bigint;
      const q = await this.approvedQueue(a.symbol);
      const low = await this.usdToUnits(a, this.cfg.lowUsd);
      assets.push({
        asset: a.symbol, decimals: a.decimals, payout_units: p.toString(), payout_usd: await this.unitsToUsd(a, p),
        approved_queue_units: q.toString(), below_floor: p < (low > q ? low : q), warm_units: w.toString(), warm_usd: await this.unitsToUsd(a, w),
      });
    }
    const warmNative = await provider.getBalance(this.warm.address);
    return {
      chain: this.cfg.chain, payout_wallet: this.payoutAddress, operating_wallet: this.warm.address, cold_address: this.cfg.cold ?? null,
      payout_native_wei: (await provider.getBalance(this.payoutAddress)).toString(), warm_native_wei: warmNative.toString(),
      warm_gas_low: warmNative < this.cfg.gasTargetWei * 2n,
      assets,
      shortfalls: ((await this.db.query(`SELECT value FROM treasury_state WHERE key = 'shortfalls'`)).rows[0]?.value as Shortfall[]) ?? [],
      daily_cap_usd: this.cfg.dailyMaxUsd, used_24h_usd: await this.usedUsd24h(),
    };
  }
}

// ── Runner and construction ───────────────────────────────────────────────────

export interface TreasuryHandle { stop(): void }

export function startTreasury(m: TreasuryManager, intervalMs: number, shouldRun?: () => boolean): TreasuryHandle {
  let running = false;
  const tick = async () => {
    if (running || shouldRun?.() === false) return;
    running = true;
    try {
      const r = await m.runOnce();
      if (r.sent) console.log('[treasury]', JSON.stringify({ sent: r.sent, shortfalls: r.shortfalls.length }));
    } catch (e) { console.error('[treasury] pass failed:', e instanceof Error ? e.message : e); }
    finally { running = false; }
  };
  const t = setInterval(() => { void tick(); }, intervalMs);
  t.unref?.();
  void tick();
  return { stop: () => clearInterval(t) };
}

export async function createTreasuryManager(cfg: TreasuryConfig, payoutAddress: string): Promise<TreasuryManager> {
  const [{ getDb }, { config }, { gatewayContext }, { forwardToUnifiedRouter }] = await Promise.all([
    import('./db.js'), import('../config.js'), import('./context.js'), import('./events.js'),
  ]);
  const ctx = await gatewayContext();
  const providers = new Map<string, ethers.JsonRpcProvider>();
  const rpc = config.rpc as Record<string, string>;
  return new TreasuryManager(getDb() as unknown as Queryable, ctx.registry, ctx.rates, cfg, payoutAddress, {
    provider(chain) {
      let p = providers.get(chain);
      if (!p) {
        if (!rpc[chain]) throw new Error(`no RPC endpoint configured for ${chain}`);
        p = new ethers.JsonRpcProvider(rpc[chain], cfg.chainId, { cacheTimeout: -1, ...(cfg.chainId ? {} : { staticNetwork: false }) });
        p.on('error', () => undefined);
        providers.set(chain, p);
      }
      return p;
    },
  }, async (type, detail) => {
    await forwardToUnifiedRouter({ eventId: randomUUID(), type, detail, occurredAt: new Date().toISOString() } as never);
  });
}
