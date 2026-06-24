/**
 * Position Tracker.
 *
 * Keeps YieldPosition records up to date by:
 *   1. Reading on-chain balances (via adapters) to compute currentValue.
 *   2. Calculating unrealizedYield = currentValue - principal.
 *   3. Building portfolio summaries for the dashboard.
 *
 * Called by the 15-minute cron job as well as on-demand by the positions API.
 *
 * PROD NOTE: On-chain reads are batched via multicall where possible.
 *            Position records live in PostgreSQL; the in-memory store here
 *            is for development only.
 */
import type { YieldPosition, PortfolioSummary } from '../types';
/**
 * Refresh every active position from chain.
 * Called by the 15-minute cron job.
 */
export declare function updateAllPositions(): Promise<void>;
/**
 * Build a portfolio summary for a single merchant.
 *
 * Aggregates across all their active positions:
 *   - total principal, current value, unrealized yield, realized yield
 *   - weighted-average APY (weighted by current value)
 *   - per-vault breakdown
 */
export declare function getPortfolioSummary(merchantId: string): PortfolioSummary;
/**
 * Refresh a single position and return the updated record.
 * Used by the positions API for on-demand refresh.
 */
export declare function refreshPosition(positionId: string): Promise<YieldPosition | null>;
/**
 * Mark a position as 'withdrawing' and record the realized yield.
 * Called by the sweep service when initiating a withdrawal.
 */
export declare function initiateWithdrawal(positionId: string): YieldPosition | null;
/**
 * Close a position after a successful on-chain withdrawal.
 */
export declare function closePosition(positionId: string): YieldPosition | null;
/**
 * Initialize all positions from the database.
 * Call this during app startup to restore persistent state.
 */
export declare function initPositionsFromDb(): Promise<void>;
//# sourceMappingURL=positionTracker.d.ts.map