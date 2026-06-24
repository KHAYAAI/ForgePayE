import type { RWAAsset, MerchantRWAPosition, IncomeDistribution, RedemptionRequest } from './types';
export declare const rwaAssets: Map<string, RWAAsset>;
export declare const positions: Map<string, MerchantRWAPosition>;
export declare const positionsByMerchant: Map<string, string[]>;
export declare const incomeDistributions: Map<string, IncomeDistribution>;
export declare const redemptionRequests: Map<string, RedemptionRequest>;
export declare function getPositionsForMerchant(merchantId: string): MerchantRWAPosition[];
export declare function addPosition(position: MerchantRWAPosition): void;
//# sourceMappingURL=store.d.ts.map