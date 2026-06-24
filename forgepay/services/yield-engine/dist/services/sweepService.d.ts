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
import type { YieldTransaction } from '../types';
/**
 * Main cron job function — sweeps all merchants with sweep enabled.
 * Invoked every SWEEP_INTERVAL_MINUTES by node-cron.
 */
export declare function sweepIdleBalances(): Promise<{
    swept: number;
    skipped: number;
    failed: number;
}>;
/**
 * Initiate a manual withdrawal from a vault back to the merchant's hot wallet.
 *
 * @param merchantId  Merchant identifier
 * @param positionId  The position to (partially) withdraw from
 * @param amountUsd   USD amount to withdraw; omit to withdraw everything
 */
export declare function scheduleWithdrawal(merchantId: string, positionId: string, amountUsd?: number): Promise<YieldTransaction>;
//# sourceMappingURL=sweepService.d.ts.map