/**
 * Opening a deposit: a one-time address the payer sends a specific asset to, with
 * the amount quoted (and, for ZARP, the rate locked) at the moment it's opened.
 *
 * Shared by POST /deposits and POST /x402/pay so both quote, round and record the
 * same way. Runs on whatever connection it's given so /x402/pay can open the
 * deposit and its payment record in one transaction.
 */

import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import { encryptPrivateKey } from './keystore.js';
import { usdToMicro, usdMicroToUnits, unitsToDecimal } from './asset-math.js';
import { quoteFor, type Quote, type RateStore } from './fx.js';
import type { AssetRegistry, ChainAsset } from './assets.js';

export interface Queryable { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }

export class AssetUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = 'AssetUnavailableError'; }
}

export interface QuotedAmount {
  asset: ChainAsset;
  quote: Quote;
  amountUsd: number;
  units: bigint;
  /** Whole tokens, e.g. "1842.5". */
  amountAsset: string;
}

/**
 * What `amountUsd` costs in `symbol` on `chain`. `mode` is 'ceil' for money the
 * gateway receives (a payer can't credit more than they sent) and 'floor' for
 * money it sends.
 */
export async function quoteAmount(
  registry: AssetRegistry, store: RateStore, symbol: string, chain: string, amountUsd: number,
  mode: 'ceil' | 'floor', now: Date = new Date(),
): Promise<QuotedAmount> {
  const asset = registry.get(symbol, chain);
  if (!asset) throw new AssetUnavailableError(`${symbol} on ${chain} is not available: ${registry.whyNot(symbol, chain)}`);
  const quote = await quoteFor(asset.symbol, asset.unit, store, now);
  const units = usdMicroToUnits(usdToMicro(amountUsd), quote.assetPerUsd, asset.decimals, mode);
  if (units <= 0n) throw new RangeError(`${amountUsd} USD is less than one unit of ${symbol}`);
  return { asset, quote, amountUsd, units, amountAsset: unitsToDecimal(units, asset.decimals) };
}

export interface OpenDepositInput {
  merchantId: string;
  symbol: string;
  chain: string;
  amountUsd: number;
  ttlSeconds: number;
  paymentId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface OpenedDeposit {
  id: string;
  address: string;
  expiresAt: string;
  quoted: QuotedAmount;
}

export async function openDeposit(
  conn: Queryable, registry: AssetRegistry, store: RateStore, input: OpenDepositInput,
  currentBlock: () => Promise<number | null>,
): Promise<OpenedDeposit> {
  const quoted = await quoteAmount(registry, store, input.symbol, input.chain, input.amountUsd, 'ceil');
  const wallet = ethers.Wallet.createRandom();
  const id = randomUUID();
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000).toISOString();
  const block = await currentBlock().catch(() => null);
  await conn.query(
    `INSERT INTO stablecoin_deposits
       (id, merchant_id, address, private_key_enc, chain, token, amount_units, amount_usd, decimals,
        payment_id, metadata, status, expires_at, from_block, scan_cursor, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12,$13,$14,now())`,
    [
      id, input.merchantId, wallet.address, await encryptPrivateKey(wallet.privateKey, wallet.address), input.chain,
      quoted.asset.symbol, quoted.units.toString(), input.amountUsd, quoted.asset.decimals,
      input.paymentId ?? null, input.metadata ? JSON.stringify(input.metadata) : null,
      expiresAt, block, block === null ? null : block - 1,
    ],
  );
  return { id, address: wallet.address, expiresAt, quoted };
}
