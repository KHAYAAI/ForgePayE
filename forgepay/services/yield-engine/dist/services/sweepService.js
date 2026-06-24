"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sweepIdleBalances = sweepIdleBalances;
exports.scheduleWithdrawal = scheduleWithdrawal;
const axios_1 = __importDefault(require("axios"));
const pino_1 = __importDefault(require("pino"));
const uuid_1 = require("uuid");
const ethers_1 = require("ethers");
const store_1 = require("../store");
const db_1 = require("../db");
const config_1 = require("../config");
const aave_1 = require("../adapters/aave");
const compound_1 = require("../adapters/compound");
const logger = (0, pino_1.default)({ name: 'sweep-service' });
/**
 * Fetch the current idle stablecoin balance for a merchant from the
 * stablecoin-gateway.
 *
 * PROD: This is an internal service-to-service call authenticated by a
 * service account JWT, not exposed to the public internet.
 */
async function fetchMerchantBalance(merchantId) {
    const url = `${config_1.config.stablecoinGatewayUrl}/internal/balances/${merchantId}`;
    try {
        const resp = await axios_1.default.get(url, { timeout: 5_000 });
        return resp.data;
    }
    catch (err) {
        logger.warn({ merchantId, err }, 'Failed to fetch merchant balance from stablecoin-gateway; using 0');
        return { merchantId, balanceUsd: 0, asset: 'USDC', chain: 'ethereum' };
    }
}
/**
 * Submit an on-chain deposit into the target vault.
 * Returns the transaction hash on success, or null if the call fails.
 */
async function executeOnChainDeposit(vaultId, amountUsd) {
    const vault = store_1.vaultsStore.get(vaultId);
    if (!vault)
        return null;
    if (!config_1.config.signerPrivateKey) {
        logger.warn('No SIGNER_PRIVATE_KEY configured — simulating deposit');
        return `0xsimulated_${Date.now().toString(16)}`;
    }
    const rpcUrl = config_1.config.rpc[vault.chain];
    const provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers_1.ethers.Wallet(config_1.config.signerPrivateKey, provider);
    // USDC has 6 decimals
    const amountUnits = BigInt(Math.round(amountUsd * 1e6));
    try {
        if (vault.protocol === 'aave_v3') {
            const adapter = new aave_1.AaveAdapter(provider, vault.chain);
            return await adapter.deposit(signer, vault.contractAddress, amountUnits);
        }
        else if (vault.protocol === 'compound_v3') {
            const adapter = new compound_1.CompoundAdapter(provider, vault.chain);
            return await adapter.deposit(signer, amountUnits);
        }
        else {
            // Ondo / manual — handled via API, no direct on-chain tx here
            logger.info({ vaultId, protocol: vault.protocol }, 'Off-chain deposit initiated');
            return `0xoffchain_${(0, uuid_1.v4)().replace(/-/g, '')}`;
        }
    }
    catch (err) {
        logger.error({ vaultId, amountUsd, err }, 'On-chain deposit failed');
        return null;
    }
}
// ── Main sweep logic ──────────────────────────────────────────────────────────
/**
 * Process a single merchant's sweep config.
 * Returns true if a sweep was initiated.
 */
async function sweepMerchant(sweepCfg) {
    const { merchantId, targetVaultId, idleThresholdUsd, keepReserveUsd } = sweepCfg;
    const balanceData = await fetchMerchantBalance(merchantId);
    const { balanceUsd, asset, chain } = balanceData;
    const sweepable = balanceUsd - keepReserveUsd;
    if (sweepable <= idleThresholdUsd) {
        logger.debug({ merchantId, balanceUsd, sweepable, idleThresholdUsd }, 'Balance below threshold; no sweep needed');
        return false;
    }
    const vault = store_1.vaultsStore.get(targetVaultId);
    if (!vault) {
        logger.warn({ merchantId, targetVaultId }, 'Target vault not found; skipping sweep');
        return false;
    }
    if (sweepable < vault.minDeposit) {
        logger.debug({ merchantId, sweepable, minDeposit: vault.minDeposit }, 'Sweepable amount below vault minimum deposit; skipping');
        return false;
    }
    // Check for an existing pending sweep to ensure idempotency
    const pendingSweep = [...store_1.txStore.values()].find((t) => t.merchantId === merchantId &&
        t.type === 'auto_sweep' &&
        t.status === 'pending');
    if (pendingSweep) {
        logger.info({ merchantId, pendingSweepId: pendingSweep.id }, 'Pending sweep exists; skipping');
        return false;
    }
    logger.info({ merchantId, sweepable, targetVaultId }, 'Initiating auto-sweep');
    // Create position record
    const positionId = (0, uuid_1.v4)();
    const now = new Date().toISOString();
    const position = {
        id: positionId,
        merchantId,
        vaultId: targetVaultId,
        principal: sweepable,
        shares: sweepable, // 1:1 approximation; real shares fetched post-deposit
        currentValue: sweepable,
        unrealizedYield: 0,
        realizedYield: 0,
        depositedAt: now,
        lastUpdatedAt: now,
        status: 'active',
    };
    store_1.positionsStore.set(positionId, position);
    // Write-through: persist position to DB (non-blocking, best-effort)
    if (store_1.useDb) {
        (0, db_1.upsertPosition)(position).catch((err) => logger.warn({ positionId, err }, 'Failed to persist sweep position to DB'));
    }
    // Create pending transaction record
    const txId = (0, uuid_1.v4)();
    const tx = {
        id: txId,
        merchantId,
        positionId,
        type: 'auto_sweep',
        amount: sweepable,
        asset: asset,
        chain,
        status: 'pending',
        createdAt: now,
    };
    store_1.txStore.set(txId, tx);
    // Write-through: persist transaction to DB (non-blocking, best-effort)
    if (store_1.useDb) {
        (0, db_1.upsertTransaction)(tx).catch((err) => logger.warn({ txId, err }, 'Failed to persist sweep transaction to DB'));
    }
    // Submit on-chain
    const txHash = await executeOnChainDeposit(targetVaultId, sweepable);
    // Update transaction record
    const updatedTx = {
        ...tx,
        txHash: txHash ?? undefined,
        status: txHash ? 'confirmed' : 'failed',
        confirmedAt: txHash ? new Date().toISOString() : undefined,
    };
    store_1.txStore.set(txId, updatedTx);
    // Write-through: persist updated transaction to DB (non-blocking, best-effort)
    if (store_1.useDb) {
        (0, db_1.upsertTransaction)(updatedTx).catch((err) => logger.warn({ txId, err }, 'Failed to persist updated sweep transaction to DB'));
    }
    if (!txHash) {
        // Revert position back to closed on failure
        const failedPosition = { ...position, status: 'closed' };
        store_1.positionsStore.set(positionId, failedPosition);
        // Write-through: persist failed position to DB (non-blocking, best-effort)
        if (store_1.useDb) {
            (0, db_1.upsertPosition)(failedPosition).catch((err) => logger.warn({ positionId, err }, 'Failed to persist failed sweep position to DB'));
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
async function sweepIdleBalances() {
    const enabledConfigs = [...store_1.sweepConfigStore.values()].filter((c) => c.enabled);
    if (enabledConfigs.length === 0) {
        logger.debug('No merchants with sweep enabled; nothing to do');
        return { swept: 0, skipped: 0, failed: 0 };
    }
    logger.info({ count: enabledConfigs.length }, 'Starting idle balance sweep');
    const results = await Promise.allSettled(enabledConfigs.map(sweepMerchant));
    let swept = 0;
    let skipped = 0;
    let failed = 0;
    for (const result of results) {
        if (result.status === 'rejected') {
            failed++;
            logger.error({ err: result.reason }, 'Sweep failed for a merchant');
        }
        else if (result.value) {
            swept++;
        }
        else {
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
async function scheduleWithdrawal(merchantId, positionId, amountUsd) {
    const position = store_1.positionsStore.get(positionId);
    if (!position)
        throw new Error(`Position not found: ${positionId}`);
    if (position.merchantId !== merchantId)
        throw new Error('Forbidden');
    if (position.status !== 'active') {
        throw new Error(`Position is not active (current status: ${position.status})`);
    }
    const vault = store_1.vaultsStore.get(position.vaultId);
    if (!vault)
        throw new Error(`Vault not found: ${position.vaultId}`);
    const withdrawAmount = amountUsd ?? position.currentValue;
    if (withdrawAmount <= 0)
        throw new Error('Withdrawal amount must be positive');
    if (withdrawAmount > position.currentValue) {
        throw new Error(`Cannot withdraw ${withdrawAmount} from position with currentValue ${position.currentValue}`);
    }
    const now = new Date().toISOString();
    const txId = (0, uuid_1.v4)();
    // Mark position as withdrawing (if full withdrawal)
    const isFullWithdrawal = withdrawAmount >= position.currentValue * 0.9999;
    if (isFullWithdrawal) {
        const withdrawingPos = { ...position, status: 'withdrawing', lastUpdatedAt: now };
        store_1.positionsStore.set(positionId, withdrawingPos);
        // Write-through: persist to DB (non-blocking, best-effort)
        if (store_1.useDb) {
            (0, db_1.upsertPosition)(withdrawingPos).catch((err) => logger.warn({ positionId, err }, 'Failed to persist withdrawing position to DB'));
        }
    }
    const tx = {
        id: txId,
        merchantId,
        positionId,
        type: 'withdrawal',
        amount: withdrawAmount,
        asset: vault.asset,
        chain: vault.chain,
        status: 'pending',
        createdAt: now,
    };
    store_1.txStore.set(txId, tx);
    // Write-through: persist transaction to DB (non-blocking, best-effort)
    if (store_1.useDb) {
        (0, db_1.upsertTransaction)(tx).catch((err) => logger.warn({ txId, err }, 'Failed to persist withdrawal transaction to DB'));
    }
    logger.info({ merchantId, positionId, withdrawAmount }, 'Withdrawal scheduled');
    // In production: push to a job queue (BullMQ / SQS) so the withdrawal is
    // processed asynchronously with retry logic.  Here we simulate confirmation.
    const simTxHash = `0xwd_${Date.now().toString(16)}`;
    const confirmed = {
        ...tx,
        txHash: simTxHash,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
    };
    store_1.txStore.set(txId, confirmed);
    // Write-through: persist confirmed transaction to DB (non-blocking, best-effort)
    if (store_1.useDb) {
        (0, db_1.upsertTransaction)(confirmed).catch((err) => logger.warn({ txId, err }, 'Failed to persist confirmed withdrawal transaction to DB'));
    }
    if (isFullWithdrawal) {
        const closedPos = {
            ...position,
            status: 'closed',
            currentValue: 0,
            shares: 0,
            realizedYield: position.realizedYield + position.unrealizedYield,
            lastUpdatedAt: new Date().toISOString(),
        };
        store_1.positionsStore.set(positionId, closedPos);
        // Write-through: persist closed position to DB (non-blocking, best-effort)
        if (store_1.useDb) {
            (0, db_1.upsertPosition)(closedPos).catch((err) => logger.warn({ positionId, err }, 'Failed to persist closed position to DB'));
        }
    }
    else {
        const partialPos = {
            ...position,
            principal: position.principal - withdrawAmount,
            currentValue: position.currentValue - withdrawAmount,
            lastUpdatedAt: new Date().toISOString(),
        };
        store_1.positionsStore.set(positionId, partialPos);
        // Write-through: persist partial position to DB (non-blocking, best-effort)
        if (store_1.useDb) {
            (0, db_1.upsertPosition)(partialPos).catch((err) => logger.warn({ positionId, err }, 'Failed to persist partial position to DB'));
        }
    }
    return confirmed;
}
//# sourceMappingURL=sweepService.js.map