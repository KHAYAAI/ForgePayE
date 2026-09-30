/**
 * The outbound USDC signer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What this is, and what it deliberately is not
 *
 * payouts.ts defines a `PayoutBroadcaster` seam and ships only
 * `UnconfiguredBroadcaster`, which refuses to run in production rather than
 * fabricate a transaction hash. This is the real implementation behind that
 * seam: an ERC-20 transfer of USDC from a hot wallet the operator controls.
 *
 * It is the most dangerous file in the service. Everything below is arranged
 * so that the dangerous thing cannot happen by accident:
 *
 *   - It is OFF unless explicitly switched on. Absent `PAYOUT_SIGNER_ENABLED`,
 *     a key, and a chain, `installPayoutSigner()` installs nothing and the
 *     refusing broadcaster stays in place. There is no default that signs.
 *
 *   - It never creates, derives or stores a key. The key arrives from the
 *     environment or a file the platform mounts, is held in memory, and is
 *     never logged, echoed in an error, or returned by any route. A signer
 *     that could mint its own key would be a signer nobody could revoke.
 *
 *   - It re-checks the limits at broadcast time. The approval gate and the
 *     absolute ceiling are already enforced when a payout is created, but a
 *     row can sit approved for a long time before anyone submits it, and the
 *     ceiling is the sort of control that must hold at the moment money
 *     actually moves — not only at the moment it was requested.
 *
 *   - It holds a rolling 24-hour spend cap, which the ledger cannot provide.
 *     Per-payout limits bound a single mistake; they do nothing about a bug
 *     that submits five hundred correct payouts in a loop. This is the control
 *     that bounds the wallet rather than the transfer.
 *
 * What it is not: an approval mechanism, a queue, or a retry. `submitPayout`
 * owns the lifecycle — it claims the row before calling here and marks it
 * failed without re-arming if this throws, because a transfer that errored may
 * still have landed. Nothing in this file may retry.
 */

import { ethers } from 'ethers';
import { readFileSync } from 'node:fs';
import {
  setPayoutBroadcaster, PAYOUT_ABSOLUTE_MAX_USD,
  type Payout, type PayoutBroadcaster, type BroadcastResult, type BroadcastHooks, type ChainOutcome,
} from './payouts.js';

// db and logger are imported lazily, inside the functions that use them.
//
// Both pull in config.ts, which throws on any missing service secret. Loading
// them at module scope made this file unimportable by anything that is not the
// running service — including the preflight CLI, whose whole job is to report
// that a signer is *not* configured, and which should not need a webhook
// secret to say so.
async function db() {
  const { getDb } = await import('./db.js');
  return getDb();
}

async function log() {
  const { logger } = await import('./logger.js');
  return logger;
}

// ── Chain registry ────────────────────────────────────────────────────────────
//
// An allowlist, not a lookup. A payout naming a chain that is not here is
// refused rather than sent somewhere with a guessed token address — the failure
// mode of a wrong address is USDC transferred to a contract that is not USDC.

const USDC_DECIMALS = 6;

const USDC_BY_CHAIN: Record<string, { address: string; chainId: number }> = {
  ethereum: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', chainId: 1 },
  polygon:  { address: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', chainId: 137 },
  base:     { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', chainId: 8453 },
  arbitrum: { address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', chainId: 42161 },
  // Base Sepolia, for staging a real signer against testnet USDC before
  // pointing it at mainnet funds.
  'base-sepolia': { address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', chainId: 84532 },
};

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
];

// ── Configuration ─────────────────────────────────────────────────────────────

export interface SignerConfig {
  chain: string;
  usdcAddress: string;
  chainId: number;
  rpcUrl: string;
  /** Rolling 24-hour ceiling across all payouts this signer sends. */
  dailyMaxUsd: number;
  /** Confirmations to wait for before reporting the payout confirmed. */
  confirmations: number;
}

export class PayoutSignerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PayoutSignerConfigError';
  }
}

/**
 * Read the signing key.
 *
 * A file path is offered first because that is how Kubernetes and most secret
 * managers deliver a secret — mounted, not exported into the process
 * environment where every child process and crash dump inherits it.
 */
function readSigningKey(): string | undefined {
  const path = process.env['PAYOUT_SIGNER_KEY_FILE'];
  if (path) {
    try {
      const key = readFileSync(path, 'utf8').trim();
      return key.length > 0 ? key : undefined;
    } catch (err) {
      // Deliberately does not include the file's contents in the message.
      throw new PayoutSignerConfigError(
        `PAYOUT_SIGNER_KEY_FILE is set to ${path} but could not be read: ` +
        `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  const inline = process.env['PAYOUT_SIGNER_PRIVATE_KEY'];
  return inline && inline.trim().length > 0 ? inline.trim() : undefined;
}

/** True only when the operator has explicitly asked for a live signer. */
export function signerRequested(): boolean {
  return process.env['PAYOUT_SIGNER_ENABLED'] === 'true';
}

/**
 * Resolve the signer's configuration, or explain precisely what is missing.
 *
 * Every failure here is a refusal to sign. None of them falls back to a
 * default, because every plausible default for "which chain" or "how much per
 * day" is a decision about someone else's money.
 */
export function resolveSignerConfig(): SignerConfig {
  const chain = process.env['PAYOUT_SIGNER_CHAIN'];
  if (!chain) {
    throw new PayoutSignerConfigError(
      'PAYOUT_SIGNER_CHAIN is not set. Supported: ' + Object.keys(USDC_BY_CHAIN).join(', '),
    );
  }

  const token = USDC_BY_CHAIN[chain];
  if (!token) {
    throw new PayoutSignerConfigError(
      `PAYOUT_SIGNER_CHAIN="${chain}" is not a supported chain. Supported: ` +
      Object.keys(USDC_BY_CHAIN).join(', '),
    );
  }

  const rpcUrl = process.env['PAYOUT_SIGNER_RPC_URL'];
  if (!rpcUrl) {
    throw new PayoutSignerConfigError('PAYOUT_SIGNER_RPC_URL is not set.');
  }

  const dailyRaw = process.env['PAYOUT_SIGNER_DAILY_MAX_USD'];
  if (!dailyRaw) {
    throw new PayoutSignerConfigError(
      'PAYOUT_SIGNER_DAILY_MAX_USD is not set. A hot wallet without a daily ceiling is ' +
      'bounded only by its balance; set it deliberately rather than inheriting a default.',
    );
  }
  const dailyMaxUsd = Number(dailyRaw);
  if (!Number.isFinite(dailyMaxUsd) || dailyMaxUsd <= 0) {
    throw new PayoutSignerConfigError('PAYOUT_SIGNER_DAILY_MAX_USD must be a positive number.');
  }

  const confirmations = Math.max(1, Number(process.env['PAYOUT_SIGNER_CONFIRMATIONS'] ?? '1'));

  // A development chain has its own id. Refused in production, where a wrong id is a wrong network.
  let chainId = token.chainId;
  const override = process.env['PAYOUT_SIGNER_CHAIN_ID'];
  if (override) {
    if (process.env['NODE_ENV'] === 'production') {
      throw new PayoutSignerConfigError('PAYOUT_SIGNER_CHAIN_ID may not be set in production.');
    }
    chainId = Number(override);
    if (!Number.isInteger(chainId) || chainId <= 0) throw new PayoutSignerConfigError('PAYOUT_SIGNER_CHAIN_ID must be a positive integer.');
  }

  return {
    chain,
    usdcAddress: token.address,
    chainId,
    rpcUrl,
    dailyMaxUsd,
    confirmations,
  };
}

// ── Rolling spend ─────────────────────────────────────────────────────────────

/**
 * USD already sent in the trailing 24 hours.
 *
 * Read from the ledger rather than an in-process counter, so a restart cannot
 * reset the cap — which would make the control worthless against exactly the
 * crash-loop it exists to bound.
 */
export async function spentLast24hUsd(): Promise<number> {
  const conn = await db();
  const res = await conn.query<{ total: string | null }>(
    `SELECT COALESCE(SUM(amount_usdc), 0) AS total
       FROM payouts
      WHERE status IN ('submitted', 'confirmed')
        AND updated_at > NOW() - INTERVAL '24 hours'`,
    [],
  );
  return Number(res.rows[0]?.total ?? 0);
}

// ── The broadcaster ───────────────────────────────────────────────────────────

/**
 * Sends ERC-20 stablecoins — USDC, USDT, ZARP or OUSD — from one hot wallet.
 *
 * Which token, and how many units of it, is decided when the payout is created and
 * stored on the row; this only checks that what it is about to send is still what
 * the registry says that token is (same contract, same decimals) and then sends
 * exactly `payout.amountUnits`. It never re-derives an amount from a rate.
 */
export class Erc20PayoutBroadcaster implements PayoutBroadcaster {
  readonly name = 'erc20';

  private readonly provider: ethers.JsonRpcProvider;
  private readonly wallet: ethers.Wallet;
  private readonly registryFor: () => Promise<{ get(symbol: string, chain: string): { address: string; decimals: number; symbol: string } | undefined; whyNot(symbol: string, chain: string): string }>;

  constructor(
    private readonly cfg: SignerConfig, privateKey: string,
    registryFor?: () => Promise<{ get(symbol: string, chain: string): { address: string; decimals: number; symbol: string } | undefined; whyNot(symbol: string, chain: string): string }>,
  ) {
    // No response caching: ethers otherwise reuses a transaction count for 250ms, so two
    // payouts sent back to back (a settlement run does exactly that) would share a nonce.
    this.provider = new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId, { cacheTimeout: -1 });
    this.wallet = new ethers.Wallet(privateKey, this.provider);
    this.registryFor = registryFor ?? (async () => (await import('./assets.js')).assetRegistry());
  }

  /** The address funds leave from. Safe to log and to expose to an operator. */
  get address(): string {
    return this.wallet.address;
  }

  /** Sends are strictly one at a time: a wallet has one nonce sequence, and two in flight would race for it. */
  private sending: Promise<unknown> = Promise.resolve();

  broadcast(payout: Payout, hooks?: BroadcastHooks): Promise<BroadcastResult> {
    const run = this.sending.then(() => this.send(payout, hooks), () => this.send(payout, hooks));
    this.sending = run.catch(() => undefined);
    return run;
  }

  /** What the chain says about a transfer this signer sent earlier. */
  async reconcile(payout: Payout): Promise<ChainOutcome> {
    if (!payout.txHash) return 'pending';
    const receipt = await this.provider.getTransactionReceipt(payout.txHash);
    if (!receipt) return 'pending';
    return receipt.status === 1 ? 'confirmed' : 'failed';
  }

  private async send(payout: Payout, hooks?: BroadcastHooks): Promise<BroadcastResult> {
    const cfg = this.cfg;

    // ── Preflight. Every check below refuses; none of them adjusts the
    // payout to make it fit, because silently sending less than was approved
    // is its own kind of wrong.

    if (payout.chain !== cfg.chain) {
      throw new Error(
        `Payout ${payout.id} is for chain "${payout.chain}" but this signer is configured for ` +
        `"${cfg.chain}". Refusing to send on the wrong chain.`,
      );
    }

    if (payout.amountUsdc > PAYOUT_ABSOLUTE_MAX_USD) {
      // Re-checked here, not only at creation: an approved row can sit for a
      // long time, and the ceiling has to hold when the money actually moves.
      throw new Error(
        `Payout ${payout.id} is $${payout.amountUsdc}, above the absolute ceiling of ` +
        `$${PAYOUT_ABSOLUTE_MAX_USD}.`,
      );
    }

    const spent = await spentLast24hUsd();
    if (spent + payout.amountUsdc > cfg.dailyMaxUsd) {
      throw new Error(
        `Payout ${payout.id} would take the trailing-24h total to ` +
        `$${(spent + payout.amountUsdc).toFixed(2)}, above the daily ceiling of ` +
        `$${cfg.dailyMaxUsd}. Refusing. Raise PAYOUT_SIGNER_DAILY_MAX_USD deliberately if this ` +
        `volume is expected.`,
      );
    }

    // Which token this payout is in, checked against the registry as it stands now. A
    // token that has stopped verifying (different contract, changed decimals, a chain
    // problem) is refused: sending units computed for one token to another is a loss.
    const registry = await this.registryFor();
    const asset = registry.get(payout.asset, cfg.chain);
    if (!asset) {
      throw new Error(`Payout ${payout.id} is in ${payout.asset}, which is not available on ${cfg.chain}: ${registry.whyNot(payout.asset, cfg.chain)}`);
    }
    if (asset.decimals !== payout.decimals) {
      throw new Error(
        `Payout ${payout.id} was priced with ${payout.decimals} decimals but ${payout.asset} now reads ${asset.decimals}. ` +
        `Refusing: the amount would be wrong by a power of ten.`,
      );
    }
    const amountUnits = BigInt(payout.amountUnits);
    if (amountUnits <= 0n) throw new Error(`Payout ${payout.id} has no amount to send.`);

    const token = new ethers.Contract(asset.address, ERC20_ABI, this.wallet);
    const balance = (await token['balanceOf']!(this.wallet.address)) as bigint;
    if (balance < amountUnits) {
      throw new Error(
        `Signing wallet holds ${ethers.formatUnits(balance, asset.decimals)} ${payout.asset} on ${cfg.chain}, ` +
        `short of the ${ethers.formatUnits(amountUnits, asset.decimals)} required for payout ${payout.id}.`,
      );
    }

    const gas = await this.provider.getBalance(this.wallet.address);
    if (gas === 0n) {
      throw new Error(
        `Signing wallet ${this.wallet.address} has no native balance on ${cfg.chain} and cannot ` +
        `pay gas. Fund it before submitting payouts.`,
      );
    }

    // ── Send. One attempt, no retry: submitPayout has already claimed the row
    // and will mark it failed rather than re-arming it, precisely because a
    // transfer that errors may still have landed on-chain.
    (await log()).info(
      { payoutId: payout.id, chain: cfg.chain, asset: payout.asset, amountUnits: payout.amountUnits, amountUsdc: payout.amountUsdc, to: payout.payeeAddress },
      `[payout-signer] broadcasting ${payout.asset} transfer`,
    );

    const tx = await token['transfer']!(payout.payeeAddress, amountUnits);
    // Recorded before waiting: from here on, a crash leaves a hash to reconcile against.
    await hooks?.onSent?.(tx.hash);
    const receipt = await tx.wait(cfg.confirmations);

    if (!receipt || receipt.status !== 1) {
      throw new Error(
        `${payout.asset} transfer for payout ${payout.id} reverted on-chain (tx ${tx.hash}). ` +
        `Reconcile before re-issuing.`,
      );
    }

    (await log()).info(
      { payoutId: payout.id, txHash: tx.hash, block: receipt.blockNumber },
      '[payout-signer] payout confirmed on-chain',
    );

    return { txHash: tx.hash };
  }
}

/** Older name, kept for callers that import it. */
export const UsdcPayoutBroadcaster = Erc20PayoutBroadcaster;

// ── Installation ──────────────────────────────────────────────────────────────

export interface InstallResult {
  installed: boolean;
  reason?: string;
  address?: string;
  chain?: string;
}

/**
 * Install the live signer, if and only if the operator asked for one.
 *
 * Called once at startup. When the signer is not requested this is a no-op and
 * `UnconfiguredBroadcaster` stays installed — so the default posture of a
 * deployment that says nothing about signing is "refuses to send", not "sends".
 *
 * A requested-but-misconfigured signer throws. That is deliberate: the operator
 * has stated an intention to move money, and quietly serving traffic with a
 * broadcaster that refuses every payout would look identical to a working
 * deployment until the first settlement run silently failed.
 */
export function installPayoutSigner(): InstallResult {
  if (!signerRequested()) {
    return {
      installed: false,
      reason: 'PAYOUT_SIGNER_ENABLED is not "true" — outbound payouts remain refused in production.',
    };
  }

  const cfg = resolveSignerConfig();
  const key = readSigningKey();
  if (!key) {
    throw new PayoutSignerConfigError(
      'PAYOUT_SIGNER_ENABLED is true but no key is configured. Set PAYOUT_SIGNER_KEY_FILE ' +
      '(preferred — a mounted secret) or PAYOUT_SIGNER_PRIVATE_KEY.',
    );
  }

  let broadcaster: Erc20PayoutBroadcaster;
  try {
    broadcaster = new Erc20PayoutBroadcaster(cfg, key);
  } catch (err) {
    // ethers throws on a malformed key with a message that can echo the input.
    // Never let that reach a log.
    throw new PayoutSignerConfigError(
      'The configured payout signing key is not a valid private key. ' +
      '(Details withheld so the key cannot reach the logs.)',
    );
  }

  setPayoutBroadcaster(broadcaster);

  void log().then((l) => l.warn(
    { chain: cfg.chain, from: broadcaster.address, dailyMaxUsd: cfg.dailyMaxUsd },
    '[payout-signer] LIVE SIGNER INSTALLED — this service can now move stablecoins',
  ));

  return { installed: true, address: broadcaster.address, chain: cfg.chain };
}
