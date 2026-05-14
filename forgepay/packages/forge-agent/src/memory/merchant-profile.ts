import type { MemoryStore } from "./store";

export interface MerchantProfile {
  merchantId:         string;
  merchantName:       string;
  businessType?:      string;   // SaaS | e-commerce | marketplace | services | other
  preferredCurrency?: string;   // ISO 4217, e.g. "USD"
  timezone?:          string;   // IANA timezone
  typicalVolume?:     string;   // "< $10k/mo" | "$10k-100k/mo" | "$100k-1M/mo" | "> $1M/mo"
  paymentMix?:        string[]; // ["card", "usdc", "crypto"]
  primaryLanguage?:   string;   // ISO 639-1
  learnedPatterns:    string[]; // Free-text patterns the agent has observed
  preferences:        Record<string, string>; // key-value preferences
  concerns:           string[]; // Recurring topics/concerns the merchant raises
  lastUpdated:        string;   // ISO-8601
}

const PROFILE_KEY = "__merchant_profile__";

export async function getMerchantProfile(
  merchantId: string,
  merchantName: string,
  store: MemoryStore
): Promise<MerchantProfile> {
  const raw = await store.getEntry(merchantId, PROFILE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as MerchantProfile;
    } catch { /* fall through to default */ }
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

export async function updateMerchantProfile(
  profile: Partial<MerchantProfile> & { merchantId: string },
  store: MemoryStore
): Promise<void> {
  const existing = await getMerchantProfile(
    profile.merchantId,
    profile.merchantName ?? profile.merchantId,
    store
  );
  const updated: MerchantProfile = {
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

export function formatProfileForPrompt(profile: MerchantProfile): string {
  const lines: string[] = ["Merchant Profile:"];
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
