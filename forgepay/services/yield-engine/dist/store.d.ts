/**
 * In-memory data store.
 *
 * PROD NOTE: Replace every Map/array here with:
 *   - PostgreSQL (via pg or Prisma) for durable records
 *   - Redis (via ioredis) for hot caches (APYs, positions)
 *
 * The Maps are keyed by entity ID (UUID strings).
 */
import type { YieldVault, YieldPosition, SweepConfig, YieldTransaction, Protocol, AssetSymbol } from './types';
export declare const vaultsStore: Map<string, YieldVault>;
export declare const positionsStore: Map<string, YieldPosition>;
export declare const sweepConfigStore: Map<string, SweepConfig>;
export declare const txStore: Map<string, YieldTransaction>;
export declare let useDb: boolean;
export declare function setUseDb(enabled: boolean): void;
export declare function getVaultsByAsset(asset: AssetSymbol): YieldVault[];
export declare function getVaultsByProtocol(protocol: Protocol): YieldVault[];
export declare function getPositionsByMerchant(merchantId: string): YieldPosition[];
export declare function getTxsByMerchant(merchantId: string): YieldTransaction[];
export declare function getSweepTxsByMerchant(merchantId: string): YieldTransaction[];
//# sourceMappingURL=store.d.ts.map