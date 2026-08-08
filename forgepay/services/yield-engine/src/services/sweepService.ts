/**
 * Sweep Service.
 *
 * Implements the auto-sweep loop that moves idle merchant stablecoin balances
 * into yield vaults, and handles scheduled withdrawals back to hot wallets.
 *
 * Sweep algorithm (per merchant):
 *   1. Read SweepConfig (enabled, idleThresholdUsd, keepReserveUsd, targetVaultId).
 *   2. Query stablecoin-gateway for the merchant's current USDC/USDT balance.
 *   3. Compute sweepable = balance − keepReserveUsd.
 *   4. If sweepable > idleThresholdUsd: open a YieldPosition and record a
 *      YieldTransaction of type 'auto_sweep'.
 *   5. If autoCompound is true: also sweep any loose yield accrued from
 *      prior positions (yield_accrual events).
 *
 * PROD NOTE:
 *   - Balance queries use the stablecoin-gateway internal REST API.
 *   - On-chain transactions use the signer from config.signerPrivateKey.
 *   - Idempotency: check for an existing pending sweep before creating one.
 *   - The in-memory store here is replaced by PostgreSQL in production.
 */

import axios from 'axios';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
import { ethers } from 'ethers';
import { sweepConfigStore, positionsStore, txStore, vaultsStore, useDb } from '../store';
import { upsertPosition, upsertTransaction, loadAllSweepConfigs } from '../db';
import { config } from '../config';
import type { YieldPosition, YieldTransaction, SweepConfig } from '../types';
import { AaveAdapter } from '../adapters/aave';
import { CompoundAdapter } from '../adapters/compound';
import { refuseSimulationInProduction } from '../lib/simulation-guard';

const logger = pino({ name: 'sweep-service' });

// ── Internal helpers ──────────────────────────────────────────────────────────

interface MerchantBalance {
  merchantId: string;
  balanceUsd: number;
  asset: 'USDC' | 'USDT';
  chain: string;
}

/**
 * Fetch the current idle stablecoin balance for a merchant from the
 * stablecoin-gateway.
 *
 * PROD: This is an internal service-to-service call authenticated by a
 * service account JWT, not exposed to the public internet.
 */
async function fetchMerchantBalance(merchantId: string): Promise<MerchantBalance> {
  const url = `${config.stablecoinGatewayUrl}/internal/balances/${merchantId}`;
  try {
    const resp = await axios.get<MerchantBalance>(url, { timeout: 5_000 });
    return resp.data;
  } catch (err) {
    logger.warn({ merchantId, err }, 'Failed to fetch merchant balance from stablecoin-gateway; using 0');
    return { merchantId, balanceUsd: 0, asset: 'USDC', chain: 'ethereum' };
  }
}

/**
 * Submit an on-chain deposit into the target vault.
 * Returns the transaction hash on success, or null if the call fails.
 */
async function executeOnChainDeposit(
  vaultId: string,
  amountUsd: number,
): Promise<string | null> {
  const vault = vaultsStore.get(vaultId);
  if (!vault) return null;

  if (!config.signerPrivateKey) {
    refuseSimulationInProduction(
      'on-chain deposit',
      'SIGNER_PRIVATE_KEY is not configured, so no transaction can be signed',
    );
    return `0xsimulated_${Date.now().toString(16)}`;
  }

  const rpcUrl  = config.rpc[vault.chain as keyof typeof config.rpc];
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer   = new ethers.Wallet(config.signerPrivateKey, provider);

  // USDC has 6 decimals
  const amountUnits = BigInt(Math.round(amountUsd * 1e6));

  try {
    if (vault.protocol === 'aave_v3') {
      const adapter = new AaveAdapter(provider, vault.chain as any);
      return await adapter.deposit(signer, vault.contractAddress, amountUnits);
    } else if (vault.protocol === 'compound_v3') {
      const adapter = new CompoundAdapter(provider, vault.chain as any);
      return await adapter.deposit(signer, amountUnits);
    } else {
      // Ondo / manual — handled via API, no direct on-chain tx here
      logger.info({ vaultId, protocol: vault.protocol }, 'Off-chain deposit initiated');
      return `0xoffchain_${uuidv4().replace(/-/g, '')}`;
    }
  } catch (err) {
    logger.error({ vaultId, amountUsd, err }, 'On-chain deposit failed');
    return null;
  }
}

// ── Main sweep logic ──────────────────────────────────────────────────────────

/**
 * Process a single merchant's sweep config.
 * Returns true if a sweep was initiated.
 */
async function sweepMerchant(sweepCfg: SweepConfig): Promise<boolean> {
  const { merchantId, targetVaultId, idleThresholdUsd, keepReserveUsd } = sweepCfg;

  const balanceData = await fetchMerchantBalance(merchantId);
  const { balanceUsd, asset, chain } = balanceData;

  const sweepable = balanceUsd - keepReserveUsd;
  if (sweepable <= idleThresholdUsd) {
    logger.debug(
      { merchantId, balanceUsd, sweepable, idleThresholdUsd },
      'Balance below threshold; no sweep needed',
    );
    return false;
  }

  const vault = vaultsStore.get(targetVaultId);
  if (!vault) {
    logger.warn({ merchantId, targetVaultId }, 'Target vault not found; skipping sweep');
    return false;
  }

  if (sweepable < vault.minDeposit) {
    logger.debug(
      { merchantId, sweepable, minDeposit: vault.minDeposit },
      'Sweepable amount below vault minimum deposit; skipping',
    );
    return false;
  }

  // Check for an existing pending sweep to ensure idempotency
  const pendingSweep = [...txStore.values()].find(
    (t) =>
      t.merchantId === merchantId &&
      t.type === 'auto_sweep' &&
      t.status === 'pending',
  );
  if (pendingSweep) {
    logger.info({ merchantId, pendingSweepId: pendingSweep.id }, 'Pending sweep exists; skipping');
    return false;
  }

  logger.info({ merchantId, sweepable, targetVaultId }, 'Initiating auto-sweep');

  // Create position record
  const positionId = uuidv4();
  const now        = new Date().toISOString();
  const position: YieldPosition = {
    id:              positionId,
    merchantId,
    vaultId:         targetVaultId,
    principal:       sweepable,
    shares:          sweepable, // 1:1 approximation; real shares fetched post-deposit
    currentValue:    sweepable,
    unrealizedYield: 0,
    realizedYield:   0,
    depositedAt:     now,
    lastUpdatedAt:   now,
    status:          'active',
  };
  positionsStore.set(positionId, position);

  // Write-through: persist position to DB (non-blocking, best-effort)
  if (useDb) {
    upsertPosition(position).catch((err) =>
      logger.warn({ positionId, err }, 'Failed to persist sweep position to DB'),
    );
  }

  // Create pending transaction record
  const txId = uuidv4();
  const tx: YieldTransaction = {
    id:          txId,
    merchantId,
    positionId,
    type:        'auto_sweep',
    amount:      sweepable,
    asset:       asset as any,
    chain,
    status:      'pending',
    createdAt:   now,
  };
  txStore.set(txId, tx);

  // Write-through: persist transaction to DB (non-blocking, best-effort)
  if (useDb) {
    upsertTransaction(tx).catch((err) =>
      logger.warn({ txId, err }, 'Failed to persist sweep transaction to DB'),
    );
  }

  // Submit on-chain
  const txHash = await executeOnChainDeposit(targetVaultId, sweepable);

  // Update transaction record
  const updatedTx: YieldTransaction = {
    ...tx,
    txHash:       txHash ?? undefined,
    status:       txHash ? 'confirmed' : 'failed',
    confirmedAt:  txHash ? new Date().toISOString() : undefined,
  };
  txStore.set(txId, updatedTx);

  // Write-through: persist updated transaction to DB (non-blocking, best-effort)
  if (useDb) {
    upsertTransaction(updatedTx).catch((err) =>
      logger.warn({ txId, err }, 'Failed to persist updated sweep transaction to DB'),
    );
  }

  if (!txHash) {
    // Revert position back to closed on failure
    const failedPosition = { ...position, status: 'closed' as const };
    positionsStore.set(positionId, failedPosition);

    // Write-through: persist failed position to DB (non-blocking, best-effort)
    if (useDb) {
      upsertPosition(failedPosition).catch((err) =>
        logger.warn({ positionId, err }, 'Failed to persist failed sweep position to DB'),
      );
    }

    logger.error({ merchantId, positionId }, 'Sweep failed — position closed');
    return false;
  }

  logger.info({ merchantId, positionId, txHash, amountUsd: sweepable }, 'Sweep confirmed');
  return true;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Main cron job function — sweeps all merchants with sweep enabled.
 * Invoked every SWEEP_INTERVAL_MINUTES by node-cron.
 */
export async function sweepIdleBalances(): Promise<{ swept: number; skipped: number; failed: number }> {
  const enabledConfigs = [...sweepConfigStore.values()].filter((c) => c.enabled);

  if (enabledConfigs.length === 0) {
    logger.debug('No merchants with sweep enabled; nothing to do');
    return { swept: 0, skipped: 0, failed: 0 };
  }

  logger.info({ count: enabledConfigs.length }, 'Starting idle balance sweep');

  const results = await Promise.allSettled(enabledConfigs.map(sweepMerchant));

  let swept   = 0;
  let skipped = 0;
  let failed  = 0;

  for (const result of results) {
    if (result.status === 'rejected') {
      failed++;
      logger.error({ err: result.reason }, 'Sweep failed for a merchant');
    } else if (result.value) {
      swept++;
    } else {
      skipped++;
    }
  }

  logger.info({ swept, skipped, failed }, 'Sweep cycle complete');
  return { swept, skipped, failed };
}

/**
 * Initiate a manual withdrawal from a vault back to the merchant's hot wallet.
 *
 * @param merchantId  Merchant identifier
 * @param positionId  The position to (partially) withdraw from
 * @param amountUsd   USD amount to withdraw; omit to withdraw everything
 */
export async function scheduleWithdrawal(
  merchantId: string,
  positionId: string,
  amountUsd?: number,
): Promise<YieldTransaction> {
  const position = positionsStore.get(positionId);
  if (!position) throw new Error(`Position not found: ${positionId}`);
  if (position.merchantId !== merchantId) throw new Error('Forbidden');
  if (position.status !== 'active') {
    throw new Error(`Position is not active (current status: ${position.status})`);
  }

  const vault = vaultsStore.get(position.vaultId);
  if (!vault) throw new Error(`Vault not found: ${position.vaultId}`);

  const withdrawAmount = amountUsd ?? position.currentValue;
  if (withdrawAmount <= 0) throw new Error('Withdrawal amount must be positive');
  if (withdrawAmount > position.currentValue) {
    throw new Error(
      `Cannot withdraw ${withdrawAmount} from position with currentValue ${position.currentValue}`,
    );
  }

  const now    = new Date().toISOString();
  const txId   = uuidv4();

  // Mark position as withdrawing (if full withdrawal)
  const isFullWithdrawal = withdrawAmount >= position.currentValue * 0.9999;
  if (isFullWithdrawal) {
    const withdrawingPos = { ...position, status: 'withdrawing' as const, lastUpdatedAt: now };
    positionsStore.set(positionId, withdrawingPos);

    // Write-through: persist to DB (non-blocking, best-effort)
    if (useDb) {
      upsertPosition(withdrawingPos).catch((err) =>
        logger.warn({ positionId, err }, 'Failed to persist withdrawing position to DB'),
      );
    }
  }

  const tx: YieldTransaction = {
    id:          txId,
    merchantId,
    positionId,
    type:        'withdrawal',
    amount:      withdrawAmount,
    asset:       vault.asset as any,
    chain:       vault.chain,
    status:      'pending',
    createdAt:   now,
  };
  txStore.set(txId, tx);

  // Write-through: persist transaction to DB (non-blocking, best-effort)
  if (useDb) {
    upsertTransaction(tx).catch((err) =>
      logger.warn({ txId, err }, 'Failed to persist withdrawal transaction to DB'),
    );
  }

  logger.info({ merchantId, positionId, withdrawAmount }, 'Withdrawal scheduled');

  // Withdrawal has no execution path at all: `AaveAdapter.withdraw` and
  // `CompoundAdapter.withdraw` are implemented but never called, so this
  // fabricates a hash and marks the transaction confirmed regardless of
  // whether a signer is configured. Until it is wired to a job queue and the
  // adapters, production must not record a withdrawal that did not happen.
  refuseSimulationInProduction(
    'vault withdrawal',
    'no execution path is wired — the adapter withdraw methods have no callers',
  );
  const simTxHash = `0xwd_${Date.now().toString(16)}`;
  const confirmed: YieldTransaction = {
    ...tx,
    txHash:      simTxHash,
    status:      'confirmed',
    confirmedAt: new Date().toISOString(),
  };
  txStore.set(txId, confirmed);

  // Write-through: persist confirmed transaction to DB (non-blocking, best-effort)
  if (useDb) {
    upsertTransaction(confirmed).catch((err) =>
      logger.warn({ txId, err }, 'Failed to persist confirmed withdrawal transaction to DB'),
    );
  }

  if (isFullWithdrawal) {
    const closedPos = {
      ...position,
      status:        'closed' as const,
      currentValue:  0,
      shares:        0,
      realizedYield: position.realizedYield + position.unrealizedYield,
      lastUpdatedAt: new Date().toISOString(),
    };
    positionsStore.set(positionId, closedPos);

    // Write-through: persist closed position to DB (non-blocking, best-effort)
    if (useDb) {
      upsertPosition(closedPos).catch((err) =>
        logger.warn({ positionId, err }, 'Failed to persist closed position to DB'),
      );
    }
  } else {
    const partialPos = {
      ...position,
      principal:       position.principal - withdrawAmount,
      currentValue:    position.currentValue - withdrawAmount,
      lastUpdatedAt:   new Date().toISOString(),
    };
    positionsStore.set(positionId, partialPos);

    // Write-through: persist partial position to DB (non-blocking, best-effort)
    if (useDb) {
      upsertPosition(partialPos).catch((err) =>
        logger.warn({ positionId, err }, 'Failed to persist partial position to DB'),
      );
    }
  }

  return confirmed;
}
