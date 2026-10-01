/**
 * Moving paid-in funds from the one-time deposit addresses to the treasury.
 *
 * Every deposit has its own address, and the gateway holds the key. Until swept, what a
 * payer sent sits in an address that only this database's encrypted blob can move.
 * Sweeping turns that into treasury funds.
 *
 * The problem with ERC-20 is gas: a transfer costs native coin, and a one-time address
 * has none. So a separate *gas wallet* drips each address exactly what its sweep needs
 * (estimated, plus a margin, less anything already there), then the address's own key
 * signs the transfer to the treasury. A little dust of native coin is left behind;
 * returning it would cost about what it is worth.
 *
 * Safety properties:
 *   - Only `confirmed` deposits are swept by the automatic pass — money that was counted,
 *     final, and credited. Partial, late and unclaimed funds are not touched unless an
 *     operator asks, by name, with a reason (POST /sweeps).
 *   - The treasury address is fixed on the sweep row when it is planned.
 *   - Each transaction hash is written the moment it is sent. A sweep found mid-flight
 *     after a crash is settled by looking that hash up; nothing is sent twice. A sweep
 *     with no recorded hash for its transfer is checked against the chain's own balance,
 *     not assumed.
 *   - The sweep moves the address's whole token balance, read from the chain at send time.
 *   - Gas above SWEEP_MAX_GAS_GWEI defers sweeps rather than paying it. A failure is
 *     recorded and blocks that deposit until a person retries it.
 *   - Deposit keys are opened only here, in memory, for the one transaction.
 */

import { isProductionLike } from './env.js';
import { ethers } from 'ethers';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AssetRegistry } from './assets.js';
import type { Queryable } from './deposit-open.js';

const ERC20 = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

// ── Configuration ─────────────────────────────────────────────────────────────

export interface SweepConfig {
  treasury: (chain: string) => string | undefined;
  gasKey: string;
  minUsd: number;
  maxGasGwei: number;
  gasMarginPct: number;
  confirmations: number;
  batch: number;
  /** Development only: the chain id an RPC reports, where it isn't the real network's. */
  chainId: (chain: string) => number | undefined;
}

export class SweepConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'SweepConfigError'; }
}

export function sweepRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['SWEEP_ENABLED'] === 'true';
}

/** Read the sweeper's configuration, refusing (never defaulting) anything that decides where money goes. */
export function resolveSweepConfig(env: NodeJS.ProcessEnv = process.env): SweepConfig {
  const prod = isProductionLike(env);
  const treasury = (chain: string) => {
    const v = env[`SWEEP_TREASURY_ADDRESS_${chain.toUpperCase()}`] ?? env['SWEEP_TREASURY_ADDRESS'];
    if (!v) return undefined;
    if (!ethers.isAddress(v) || /^0x0{40}$/i.test(v)) throw new SweepConfigError(`the sweep treasury address for ${chain} is not a usable address`);
    return ethers.getAddress(v.toLowerCase());
  };
  if (!env['SWEEP_TREASURY_ADDRESS'] && !Object.keys(env).some((k) => k.startsWith('SWEEP_TREASURY_ADDRESS_'))) {
    throw new SweepConfigError('SWEEP_ENABLED is true but no treasury is set. Set SWEEP_TREASURY_ADDRESS (or SWEEP_TREASURY_ADDRESS_<CHAIN>).');
  }
  for (const k of Object.keys(env)) if (k.startsWith('SWEEP_TREASURY_ADDRESS')) treasury(k.replace('SWEEP_TREASURY_ADDRESS_', '').toLowerCase() || 'base');

  let gasKey = env['SWEEP_GAS_PRIVATE_KEY']?.trim();
  if (env['SWEEP_GAS_KEY_FILE']) {
    try { gasKey = readFileSync(env['SWEEP_GAS_KEY_FILE'], 'utf8').trim(); }
    catch (e) { throw new SweepConfigError(`SWEEP_GAS_KEY_FILE could not be read: ${(e as Error).message}`); }
  }
  if (!gasKey) throw new SweepConfigError('SWEEP_ENABLED is true but no gas wallet key is set (SWEEP_GAS_KEY_FILE preferred, or SWEEP_GAS_PRIVATE_KEY).');
  try { new ethers.Wallet(gasKey); } catch { throw new SweepConfigError('the sweep gas wallet key is not a valid private key (details withheld).'); }

  const num = (k: string, d: number) => { const n = Number(env[k] ?? d); if (!Number.isFinite(n) || n < 0) throw new SweepConfigError(`${k} must be a non-negative number`); return n; };
  if (prod && Object.keys(env).some((k) => k.startsWith('SWEEP_CHAIN_ID_'))) throw new SweepConfigError('SWEEP_CHAIN_ID_<CHAIN> may not be set in production.');
  return {
    treasury, gasKey,
    minUsd: num('SWEEP_MIN_USD', 1),
    maxGasGwei: num('SWEEP_MAX_GAS_GWEI', 50),
    gasMarginPct: num('SWEEP_GAS_MARGIN_PCT', 20),
    confirmations: Math.max(1, num('SWEEP_CONFIRMATIONS', 1)),
    batch: Math.max(1, num('SWEEP_BATCH', 10)),
    chainId: (chain) => (env[`SWEEP_CHAIN_ID_${chain.toUpperCase()}`] ? Number(env[`SWEEP_CHAIN_ID_${chain.toUpperCase()}`]) : undefined),
  };
}

// ── Pure helpers (tested directly) ────────────────────────────────────────────

/** Native coin a one-time address needs to pay for its sweep, given what it already holds. */
export function gasDripWei(gasLimit: bigint, maxFeePerGas: bigint, marginPct: number, alreadyThere: bigint): bigint {
  const need = (gasLimit * maxFeePerGas * BigInt(100 + Math.round(marginPct))) / 100n;
  return need > alreadyThere ? need - alreadyThere : 0n;
}

/**
 * Native coin worth sending back from a swept address to the gas wallet: what is left
 * after the sweep, less the cost of the return transfer itself. Zero unless that is a
 * real amount — returning a few wei costs more than it recovers.
 */
export function dustReturnWei(balance: bigint, maxFeePerGas: bigint): bigint {
  const cost = 21_000n * maxFeePerGas;
  const net = balance - cost;
  return net > cost / 4n ? net : 0n; // not worth a transaction unless it recovers a meaningful part of its own cost
}

/** Whether a deposit is worth the gas to sweep. */
export function worthSweeping(amountUsd: number, minUsd: number): boolean {
  return amountUsd >= minUsd;
}

// ── The sweeper ───────────────────────────────────────────────────────────────

export interface SweepRow {
  id: string; deposit_id: string; chain: string; asset: string; from_address: string; treasury_address: string;
  status: 'planned' | 'gas_sent' | 'sending' | 'swept' | 'failed' | 'skipped';
  units: string | null; gas_wei: string | null; gas_tx: string | null; sweep_tx: string | null;
  reason: string | null; error: string | null; created_at: Date; updated_at: Date;
  kind: 'sweep' | 'recovery'; dust_wei: string | null; dust_tx: string | null;
}

export interface SweepDeps {
  provider(chain: string): ethers.JsonRpcProvider;
  decrypt(blob: string, address: string): Promise<string>;
}

export interface SweepReport { swept: number; skipped: number; failed: number; deferred: number; resumed: number }

/** A sweep stuck 'sending' with no receipt this long is treated as dropped, for a person to look at. */
const DROPPED_AFTER_MS = 15 * 60_000;

export class Sweeper {
  private chain: Promise<unknown> = Promise.resolve();
  private gasWallets = new Map<string, ethers.Wallet>();

  constructor(
    private readonly db: Queryable, private readonly registry: AssetRegistry,
    private readonly cfg: SweepConfig, private readonly deps: SweepDeps,
  ) {}

  gasWalletFor(chain: string): ethers.Wallet {
    let w = this.gasWallets.get(chain);
    if (!w) { w = new ethers.Wallet(this.cfg.gasKey, this.deps.provider(chain)); this.gasWallets.set(chain, w); }
    return w;
  }

  /** One pass over a chain: resume anything in flight, then plan and run new sweeps. Serialised. */
  runOnce(chain: string): Promise<SweepReport> {
    const run = this.chain.then(() => this.pass(chain), () => this.pass(chain));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async pass(chain: string): Promise<SweepReport> {
    const rep: SweepReport = { swept: 0, skipped: 0, failed: 0, deferred: 0, resumed: 0 };
    const treasury = this.cfg.treasury(chain);
    if (!treasury) return rep;

    const active = await this.db.query(
      `SELECT * FROM deposit_sweeps WHERE chain = $1 AND status IN ('planned','gas_sent','sending') ORDER BY created_at`, [chain]);
    for (const row of active.rows as SweepRow[]) { rep.resumed++; this.tally(rep, await this.advance(row)); }

    const room = this.cfg.batch - rep.resumed;
    if (room > 0) {
      const cands = await this.db.query(
        `SELECT d.id, d.address, d.token, d.amount_usd FROM stablecoin_deposits d
          WHERE d.chain = $1 AND d.status = 'confirmed' AND d.swept_at IS NULL AND d.amount_usd >= $2
            AND NOT EXISTS (SELECT 1 FROM deposit_sweeps s WHERE s.deposit_id = d.id AND s.asset = d.token AND s.status IN ('planned','gas_sent','sending','failed','swept'))
          ORDER BY d.confirmed_at LIMIT $3`, [chain, this.cfg.minUsd, room]);
      for (const d of cands.rows) {
        const row = await this.plan(d.id, chain, d.token, d.address, treasury, null);
        if (row) this.tally(rep, await this.advance(row));
      }
    }
    return rep;
  }

  private tally(rep: SweepReport, s: SweepRow['status'] | 'deferred') {
    if (s === 'swept') rep.swept++; else if (s === 'skipped') rep.skipped++; else if (s === 'failed') rep.failed++; else if (s === 'deferred') rep.deferred++;
  }

  private async plan(depositId: string, chain: string, asset: string, from: string, treasury: string, reason: string | null, kind: 'sweep' | 'recovery' = 'sweep'): Promise<SweepRow | null> {
    const r = await this.db.query(
      `INSERT INTO deposit_sweeps (id, deposit_id, chain, asset, from_address, treasury_address, reason, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING *`,
      [randomUUID(), depositId, chain, asset, from, treasury, reason, kind]);
    return (r.rows[0] as SweepRow) ?? null;
  }

  /** An operator's request to sweep a specific deposit that the automatic pass won't touch (expired, short, late). */
  async planManual(depositId: string, reason: string): Promise<SweepRow> {
    const d = (await this.db.query(`SELECT id, chain, token, address, status FROM stablecoin_deposits WHERE id = $1`, [depositId])).rows[0];
    if (!d) throw new Error('no such deposit');
    if (d.status === 'pending' || d.status === 'confirming') throw new Error(`the deposit is still ${d.status}; it can be swept once it has confirmed or expired`);
    const treasury = this.cfg.treasury(d.chain);
    if (!treasury) throw new Error(`no treasury is configured for ${d.chain}`);
    const row = await this.plan(d.id, d.chain, d.token, d.address, treasury, reason);
    if (!row) throw new Error('this deposit already has a sweep in progress, failed awaiting review, or completed');
    return row;
  }

  /** After a person has looked at a failed sweep: put it back to be tried again. */
  async retry(sweepId: string): Promise<SweepRow | null> {
    const r = await this.db.query(`UPDATE deposit_sweeps SET status = 'planned', error = NULL, updated_at = NOW() WHERE id = $1 AND status = 'failed' RETURNING *`, [sweepId]);
    return (r.rows[0] as SweepRow) ?? null;
  }

  private async set(id: string, patch: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(patch);
    await this.db.query(`UPDATE deposit_sweeps SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = NOW() WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
  }

  private async fail(row: SweepRow, error: string): Promise<'failed'> {
    await this.set(row.id, { status: 'failed', error });
    console.error(`[sweeper] sweep ${row.id} (deposit ${row.deposit_id}) failed: ${error}`);
    return 'failed';
  }

  /** Move one sweep as far along as it can go right now. */
  private async advance(row: SweepRow): Promise<SweepRow['status'] | 'deferred'> {
    try {
      const provider = this.deps.provider(row.chain);
      // A registered token, or (for recovering something unrecognised) a bare contract address an operator named.
      const asset = /^0x[0-9a-fA-F]{40}$/.test(row.asset)
        ? { address: ethers.getAddress(row.asset), symbol: row.asset }
        : this.registry.get(row.asset, row.chain);
      if (!asset) return 'deferred'; // can't read this token right now: leave it, don't guess

      // A sweep may only ever pay the treasury this gateway is CONFIGURED with. The destination was copied
      // into the row when it was planned; anyone who can write to the database could have changed it since,
      // so it is checked against configuration at the moment of sending, not trusted from the row.
      if (row.kind === 'sweep') {
        const configured = this.cfg.treasury(row.chain);
        if (!configured) return 'deferred';
        if (configured.toLowerCase() !== String(row.treasury_address).toLowerCase()) {
          return await this.fail(row, `the sweep's destination ${row.treasury_address} is not the configured treasury ${configured}; not sent`);
        }
      }

      // ── A transfer already sent: settle it from the chain, never send again.
      if (row.status === 'sending') {
        if (!row.sweep_tx) return await this.fail(row, 'in state "sending" with no recorded transaction');
        const receipt = await provider.getTransactionReceipt(row.sweep_tx);
        if (receipt) {
          if (receipt.status !== 1) return await this.fail(row, `transfer ${row.sweep_tx} reverted on-chain`);
          await this.finish(row);
          return 'swept';
        }
        if (Date.now() - new Date(row.updated_at).getTime() > DROPPED_AFTER_MS) {
          return await this.fail(row, `transfer ${row.sweep_tx} has no receipt after ${DROPPED_AFTER_MS / 60000} minutes; it may have been dropped. Check the address's balance before retrying.`);
        }
        return 'deferred';
      }

      const token = new ethers.Contract(asset.address, ERC20, provider);
      const balance = (await token['balanceOf']!(row.from_address)) as bigint;
      if (balance === 0n) {
        await this.set(row.id, { status: 'skipped', units: '0', error: 'the address holds none of this token' });
        if (row.kind === 'sweep') await this.db.query(`UPDATE stablecoin_deposits SET swept_at = NOW() WHERE id = $1`, [row.deposit_id]);
        return 'skipped';
      }

      // ── Gas.
      const fee = await provider.getFeeData();
      const maxFee = fee.maxFeePerGas ?? fee.gasPrice;
      if (maxFee === null || maxFee === undefined) return 'deferred';
      if (maxFee > BigInt(Math.round(this.cfg.maxGasGwei * 1e9))) {
        console.warn(`[sweeper] gas is ${Number(maxFee) / 1e9} gwei, above the ${this.cfg.maxGasGwei} gwei ceiling; deferring ${row.id}`);
        return 'deferred';
      }
      const tip = fee.maxPriorityFeePerGas !== null && fee.maxPriorityFeePerGas !== undefined && fee.maxPriorityFeePerGas <= maxFee ? fee.maxPriorityFeePerGas : maxFee;
      const iface = new ethers.Interface(ERC20);
      const gasLimit = ((await provider.estimateGas({
        from: row.from_address, to: asset.address, data: iface.encodeFunctionData('transfer', [row.treasury_address, balance]),
      })) * 130n) / 100n;

      if (row.status === 'planned') {
        const have = await provider.getBalance(row.from_address);
        const drip = gasDripWei(gasLimit, maxFee, this.cfg.gasMarginPct, have);
        if (drip > 0n) {
          const gasWallet = this.gasWalletFor(row.chain);
          if ((await provider.getBalance(gasWallet.address)) < drip) {
            console.warn(`[sweeper] gas wallet ${gasWallet.address} cannot cover ${drip} wei for ${row.id}; deferring. Fund it.`);
            return 'deferred';
          }
          const tx = await gasWallet.sendTransaction({ to: row.from_address, value: drip });
          await this.set(row.id, { status: 'gas_sent', gas_wei: drip.toString(), gas_tx: tx.hash }); // recorded before waiting
          await tx.wait(this.cfg.confirmations);
        } else {
          await this.set(row.id, { status: 'gas_sent', gas_wei: '0' });
        }
        row = { ...row, status: 'gas_sent' };
      } else if (row.status === 'gas_sent' && row.gas_tx) {
        const r = await provider.getTransactionReceipt(row.gas_tx);
        if (r && r.status !== 1) return await this.fail(row, `gas transfer ${row.gas_tx} reverted`);
        if (!r) await provider.waitForTransaction(row.gas_tx, this.cfg.confirmations, 60_000);
      }

      // ── The sweep itself, signed by the deposit address's own key.
      const dep = (await this.db.query(`SELECT private_key_enc, address FROM stablecoin_deposits WHERE id = $1`, [row.deposit_id])).rows[0];
      if (!dep) return await this.fail(row, 'the deposit row is gone');
      let key: string;
      try { key = await this.deps.decrypt(dep.private_key_enc, dep.address); }
      catch (e) { return await this.fail(row, `could not open the deposit key: ${(e as Error).message}`); }
      const wallet = new ethers.Wallet(key, provider);
      if (wallet.address.toLowerCase() !== row.from_address.toLowerCase()) return await this.fail(row, 'the stored key does not belong to this deposit address');

      const current = (await token['balanceOf']!(row.from_address)) as bigint; // whatever is there now
      const tx = await (token.connect(wallet) as ethers.Contract)['transfer']!(row.treasury_address, current, {
        gasLimit, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip,
      });
      await this.set(row.id, { status: 'sending', sweep_tx: tx.hash, units: current.toString() }); // recorded before waiting
      const receipt = await tx.wait(this.cfg.confirmations);
      if (!receipt || receipt.status !== 1) return await this.fail({ ...row, sweep_tx: tx.hash }, `transfer ${tx.hash} reverted on-chain`);
      await this.finish(row);
      await this.returnDust(row, wallet, maxFee, tip); // best effort: never fails the sweep
      return 'swept';
    } catch (err) {
      // Nothing irreversible is assumed on an error before a hash was recorded: the row stays
      // where it was and the next pass tries again. After a hash was recorded, a pass reads the chain.
      console.error(`[sweeper] sweep ${row.id} not advanced this pass:`, err instanceof Error ? err.message : err);
      return 'deferred';
    }
  }

  private async finish(row: SweepRow): Promise<void> {
    await this.set(row.id, { status: 'swept', error: null });
    // Only moving the deposit's own token completes the deposit; recovering a stray one does not.
    if (row.kind === 'sweep') await this.db.query(`UPDATE stablecoin_deposits SET swept_at = NOW() WHERE id = $1`, [row.deposit_id]);
  }

  /**
   * Send what is left of the gas drip back to the gas wallet. The drip covers the gas
   * *limit*, which is more than the transfer used, so a real amount is usually left;
   * a return is only made when it recovers more than a fraction of its own cost.
   */
  private async returnDust(row: SweepRow, wallet: ethers.Wallet, maxFee: bigint, tip: bigint): Promise<void> {
    try {
      const provider = this.deps.provider(row.chain);
      const left = await provider.getBalance(wallet.address);
      const back = dustReturnWei(left, maxFee);
      if (back === 0n) return;
      const tx = await wallet.sendTransaction({ to: this.gasWalletFor(row.chain).address, value: back, gasLimit: 21_000n, maxFeePerGas: maxFee, maxPriorityFeePerGas: tip });
      await this.set(row.id, { dust_wei: back.toString(), dust_tx: tx.hash });
      await tx.wait(this.cfg.confirmations);
    } catch (err) {
      console.warn(`[sweeper] could not return dust from ${row.from_address}:`, err instanceof Error ? err.message : err);
    }
  }

  // ── Tokens that arrived at a deposit address but aren't what it was opened for ──

  /**
   * What a deposit address holds besides its own token, among the tokens this gateway
   * knows, and who sent it. Other tokens can't be discovered without an indexer: for one
   * of those, an operator names the contract.
   */
  async strays(depositId: string): Promise<{ deposit_id: string; address: string; chain: string; token: string; strays: Array<{ asset: string; units: string; senders: string[] }> } | null> {
    const d = (await this.db.query(`SELECT id, address, chain, token, from_block FROM stablecoin_deposits WHERE id = $1`, [depositId])).rows[0];
    if (!d) return null;
    const provider = this.deps.provider(d.chain);
    const out: Array<{ asset: string; units: string; senders: string[] }> = [];
    for (const a of this.registry.available().filter((x) => x.chain === d.chain && x.symbol !== d.token)) {
      const c = new ethers.Contract(a.address, ERC20, provider);
      const bal = (await c['balanceOf']!(d.address)) as bigint;
      if (bal === 0n) continue;
      const senders = new Set<string>();
      try {
        const head = await provider.getBlockNumber();
        const start = d.from_block !== null ? Number(d.from_block) : Math.max(0, head - 50_000);
        for (let from = start; from <= head; from += 2000) {
          const logs = await provider.getLogs({ address: a.address, fromBlock: from, toBlock: Math.min(head, from + 1999),
            topics: [ethers.id('Transfer(address,address,uint256)'), null, ethers.zeroPadValue(d.address, 32)] });
          for (const l of logs) senders.add(ethers.getAddress('0x' + l.topics[1]!.slice(26)));
        }
      } catch { /* senders are a convenience; the balance is the fact */ }
      out.push({ asset: a.symbol, units: bal.toString(), senders: [...senders] });
    }
    return { deposit_id: d.id, address: d.address, chain: d.chain, token: d.token, strays: out };
  }

  /**
   * Plan the return of a stray token to an address the operator names — normally the
   * sender, since it was theirs — with a reason. `asset` is a symbol or a contract address.
   */
  async planRecovery(depositId: string, asset: string, destination: string, reason: string): Promise<SweepRow> {
    const d = (await this.db.query(`SELECT id, chain, token, address, status FROM stablecoin_deposits WHERE id = $1`, [depositId])).rows[0];
    if (!d) throw new Error('no such deposit');
    if (!ethers.isAddress(destination) || /^0x0{40}$/i.test(destination)) throw new Error('destination is not a usable address');
    const dest = ethers.getAddress(destination.toLowerCase());
    if (dest.toLowerCase() === String(d.address).toLowerCase()) throw new Error('the destination is the deposit address itself');
    const sym = /^0x/i.test(asset) ? (ethers.isAddress(asset) ? ethers.getAddress(asset.toLowerCase()) : '') : asset.toUpperCase();
    if (!sym) throw new Error('asset must be a token symbol or a contract address');
    if (sym === d.token) throw new Error(`that is the deposit's own token: sweep it to the treasury, don't refund it`);
    // The same rule when the token is named by contract address: that must not be a way round it.
    const own = this.registry.get(d.token, d.chain);
    if (own && /^0x/.test(sym) && own.address.toLowerCase() === sym.toLowerCase()) {
      throw new Error(`that is the deposit's own token: sweep it to the treasury, don't refund it`);
    }
    if (!/^0x/.test(sym) && !this.registry.get(sym, d.chain)) throw new Error(`${sym} is not a token this gateway knows on ${d.chain}; pass its contract address instead`);
    const row = await this.plan(d.id, d.chain, sym, d.address, dest, reason, 'recovery');
    if (!row) throw new Error('a recovery of that token from this address is already in progress, awaiting review, or done');
    return row;
  }
}

// ── The runner ────────────────────────────────────────────────────────────────

export interface SweepHandle { stop(): void }

export function startSweeper(sweeper: Sweeper, chains: string[], intervalMs: number, shouldRun?: () => boolean): SweepHandle {
  let running = false;
  const tick = async () => {
    if (running || shouldRun?.() === false) return;
    running = true;
    try {
      for (const chain of chains) {
        const r = await sweeper.runOnce(chain).catch((e) => { console.error(`[sweeper] pass on ${chain} failed:`, e instanceof Error ? e.message : e); return null; });
        if (r && (r.swept || r.failed || r.skipped)) console.log(`[sweeper] ${chain}`, JSON.stringify(r));
      }
    } finally { running = false; }
  };
  const t = setInterval(() => { void tick(); }, intervalMs);
  t.unref?.();
  void tick();
  return { stop: () => clearInterval(t) };
}

/** Build a sweeper over the gateway's real database, registry, RPC endpoints and key store. */
export async function createSweeper(cfg: SweepConfig): Promise<Sweeper> {
  const [{ getDb }, { config }, { gatewayContext }, { decryptPrivateKey }] = await Promise.all([
    import('./db.js'), import('../config.js'), import('./context.js'), import('./keystore.js'),
  ]);
  const ctx = await gatewayContext();
  const providers = new Map<string, ethers.JsonRpcProvider>();
  const rpc = config.rpc as Record<string, string>;
  return new Sweeper(getDb() as unknown as Queryable, ctx.registry, cfg, {
    provider(chain) {
      let p = providers.get(chain);
      if (!p) {
        if (!rpc[chain]) throw new Error(`no RPC endpoint configured for ${chain}`);
        const id = cfg.chainId(chain);
        p = new ethers.JsonRpcProvider(rpc[chain], id, { cacheTimeout: -1, ...(id ? {} : { staticNetwork: false }) });
        p.on('error', () => undefined);
        providers.set(chain, p);
      }
      return p;
    },
    decrypt: decryptPrivateKey,
  });
}
