"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMerchantProfile = getMerchantProfile;
exports.updateMerchantProfile = updateMerchantProfile;
exports.formatProfileForPrompt = formatProfileForPrompt;
const PROFILE_KEY = "__merchant_profile__";
async function getMerchantProfile(merchantId, merchantName, store) {
    const raw = await store.getEntry(merchantId, PROFILE_KEY);
    if (raw) {
        try {
            return JSON.parse(raw);
        }
        catch { /* fall through to default */ }
    }
    return {
        merchantId,
        merchantName,
        learnedPatterns: [],
        preferences: {},
        concerns: [],
        lastUpdated: new Date().toISOString(),
    };
}
async function updateMerchantProfile(profile, store) {
    const existing = await getMerchantProfile(profile.merchantId, profile.merchantName ?? profile.merchantId, store);
    const updated = {
        ...existing,
        ...profile,
        learnedPatterns: [
            ...new Set([
                ...(existing.learnedPatterns ?? []),
                ...(profile.learnedPatterns ?? []),
            ]),
        ],
        concerns: [
            ...new Set([
                ...(existing.concerns ?? []),
                ...(profile.concerns ?? []),
            ]),
        ],
        preferences: {
            ...existing.preferences,
            ...(profile.preferences ?? {}),
        },
        lastUpdated: new Date().toISOString(),
    };
    await store.store(profile.merchantId, PROFILE_KEY, JSON.stringify(updated));
}
function formatProfileForPrompt(profile) {
    const lines = ["Merchant Profile:"];
    if (profile.businessType)
        lines.push(`  Business type: ${profile.businessType}`);
    if (profile.preferredCurrency)
        lines.push(`  Preferred currency: ${profile.preferredCurrency}`);
    if (profile.timezone)
        lines.push(`  Timezone: ${profile.timezone}`);
    if (profile.typicalVolume)
        lines.push(`  Monthly volume: ${profile.typicalVolume}`);
    if (profile.paymentMix?.length)
        lines.push(`  Payment methods: ${profile.paymentMix.join(", ")}`);
    if (profile.learnedPatterns.length > 0) {
        lines.push("  Observed patterns:");
        profile.learnedPatterns.slice(-5).forEach(p => lines.push(`    - ${p}`));
    }
    if (profile.concerns.length > 0) {
        lines.push(`  Recurring concerns: ${profile.concerns.slice(-3).join(", ")}`);
    }
    const prefEntries = Object.entries(profile.preferences);
    if (prefEntries.length > 0) {
        lines.push("  Preferences:");
        prefEntries.forEach(([k, v]) => lines.push(`    ${k}: ${v}`));
    }
    return lines.join("\n");
}
//# sourceMappingURL=merchant-profile.js.map