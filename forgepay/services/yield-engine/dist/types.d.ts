/**
 * Domain types for the ForgePay Yield Engine.
 *
 * These interfaces are the contract between adapters, services, and routes.
 * All monetary values are in full USD units (not micro-units) unless otherwise noted.
 */
export type Protocol = 'aave_v3' | 'compound_v3' | 'ondo_usdy' | 'superstate_ustb' | 'manual';
export type AssetSymbol = 'USDC' | 'USDT' | 'DAI' | 'USDY' | 'USTB';
export type ChainName = 'ethereum' | 'polygon' | 'base' | 'arbitrum';
/**
 * A yield vault is a specific deployment of a yield protocol on one chain.
 * Multiple vaults can exist for the same protocol (e.g., Aave USDC on Polygon
 * vs. Aave USDC on Arbitrum).
 */
export interface YieldVault {
    id: string;
    protocol: Protocol;
    name: string;
    asset: AssetSymbol;
    chain: ChainName;
    contractAddress: string;
    /** Current supply APY as a decimal — 0.045 means 4.5 % */
    apy: number;
    apyUpdatedAt: string;
    /** Total value locked in USD */
    tvl: number;
    /** Minimum deposit in USD */
    minDeposit: number;
    /** Human-readable withdrawal delay: "instant" | "24h" | "7d" */
    withdrawalDelay: string;
    riskLevel: 'low' | 'medium' | 'high';
    audited: boolean;
}
/**
 * A YieldPosition records a merchant's active stake in a single vault.
 * One merchant may hold multiple positions across different vaults.
 *
 * PROD NOTE: persisted to PostgreSQL `yield_positions` table.
 *            In-memory store is used here for development.
 */
export interface YieldPosition {
    id: string;
    merchantId: string;
    vaultId: string;
    /** Original USDC/USDT amount deposited in USD */
    principal: number;
    /** Vault shares / receipt tokens held (e.g., aUSDC, cUSDCv3) */
    shares: number;
    /** principal + accrued yield, denominated in USD — refreshed every cron tick */
    currentValue: number;
    unrealizedYield: number;
    realizedYield: number;
    depositedAt: string;
    lastUpdatedAt: string;
    status: 'active' | 'withdrawing' | 'closed';
}
/**
 * Per-merchant auto-sweep configuration.
 * Stored in PostgreSQL `sweep_configs` in production; in-memory map here.
 */
export interface SweepConfig {
    merchantId: string;
    enabled: boolean;
    /** Initiate a sweep when the idle balance exceeds this threshold in USD */
    idleThresholdUsd: number;
    /** The vault to sweep idle funds into */
    targetVaultId: string;
    /** Always keep at least this much liquid in the merchant's hot wallet */
    keepReserveUsd: number;
    /** Automatically re-deposit accrued yield instead of leaving it idle */
    autoCompound: boolean;
}
/**
 * Immutable ledger entry for every on-chain interaction.
 * PROD NOTE: append-only `yield_transactions` table in PostgreSQL.
 */
export interface YieldTransaction {
    id: string;
    merchantId: string;
    positionId: string;
    type: 'deposit' | 'withdrawal' | 'yield_accrual' | 'auto_sweep';
    /** USD amount */
    amount: number;
    asset: AssetSymbol;
    /** On-chain transaction hash — absent for pending / failed off-chain ops */
    txHash?: string;
    chain: string;
    status: 'pending' | 'confirmed' | 'failed';
    createdAt: string;
    confirmedAt?: string;
}
export interface ApyCacheEntry {
    apy: number;
    fetchedAt: number;
}
export interface VaultAllocation {
    vaultId: string;
    vaultName: string;
    protocol: Protocol;
    principal: number;
    currentValue: number;
    unrealizedYield: number;
    apy: number;
}
export interface PortfolioSummary {
    merchantId: string;
    totalPrincipal: number;
    totalCurrentValue: number;
    totalUnrealizedYield: number;
    totalRealizedYield: number;
    weightedApy: number;
    allocations: VaultAllocation[];
    updatedAt: string;
}
export interface BaseYieldAdapter {
    protocol: Protocol;
    getCurrentApy(): Promise<number>;
    getBalance(address: string): Promise<number>;
}
//# sourceMappingURL=types.d.ts.map