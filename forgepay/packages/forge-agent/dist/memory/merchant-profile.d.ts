import type { MemoryStore } from "./store";
export interface MerchantProfile {
    merchantId: string;
    merchantName: string;
    businessType?: string;
    preferredCurrency?: string;
    timezone?: string;
    typicalVolume?: string;
    paymentMix?: string[];
    primaryLanguage?: string;
    learnedPatterns: string[];
    preferences: Record<string, string>;
    concerns: string[];
    lastUpdated: string;
}
export declare function getMerchantProfile(merchantId: string, merchantName: string, store: MemoryStore): Promise<MerchantProfile>;
export declare function updateMerchantProfile(profile: Partial<MerchantProfile> & {
    merchantId: string;
}, store: MemoryStore): Promise<void>;
export declare function formatProfileForPrompt(profile: MerchantProfile): string;
//# sourceMappingURL=merchant-profile.d.ts.map