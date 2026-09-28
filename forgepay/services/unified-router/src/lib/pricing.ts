/**
 * Pricing — the single source of truth for what checkout charges.
 *
 * Reads forgepay/config/pricing.yaml at boot and caches it. This is the fix
 * for the exact gap flagged in docs/PRICING_IMPLEMENTATION_GUIDE.md: apps/web
 * used to import pricing.ts and Features.tsx/Pricing.tsx off one shared
 * constants file so they could never contradict each other; apps/web is
 * retired now and forgepay/website's pricing sections are hand-authored HTML
 * with no shared source. routes/checkout.ts is the one place that actually
 * charges money, so it reads the real config file directly rather than
 * repeating numbers a third time.
 *
 * Never trust a client-supplied price. Every amount charged in
 * routes/checkout.ts comes from here, keyed by tier id, not from the request
 * body — a request can say which tier, never how much that tier costs.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { config } from '../config.js';

// This service compiles to CommonJS (see tsconfig.json) — __dirname is a
// real CommonJS global here, not the import.meta.url dance an ESM build
// would need.

export interface TierFees {
  card:       { percentage: number; fixed: number };
  stablecoin: { percentage: number; fixed: number };
  crypto:     { percentage: number; fixed: number };
}

export interface PricingTier {
  id: string;
  name: string;
  monthlyFee: number; // USD
  fees: TierFees;
  limits: Record<string, unknown>;
  features: Record<string, boolean>;
}

export interface PricingConfig {
  tiers: Record<string, PricingTier>;
}

interface RawTier {
  id: string;
  name: string;
  monthly_fee: number;
  fees: {
    card: { percentage: number; fixed: number };
    stablecoin: { percentage: number; fixed: number };
    crypto: { percentage: number; fixed: number };
  };
  limits?: Record<string, unknown>;
  features?: Record<string, boolean>;
}

interface RawPricingYaml {
  tiers: Record<string, RawTier>;
}

let cached: PricingConfig | null = null;

/**
 * Resolve pricing.yaml's path.
 *
 * "Two directories up from here" means different things in the three places
 * this actually runs from, because __dirname's depth differs in each:
 *   - Docker (dist/lib/, pricing.yaml COPY'd to /app/config/)  -> ../../config/pricing.yaml
 *   - Compiled locally (services/unified-router/dist/lib/)      -> ../../../../config/pricing.yaml
 *   - tsx/dev running straight from src/lib/                    -> ../../../../config/pricing.yaml
 * An explicit PRICING_YAML_PATH always wins. Otherwise, rather than picking
 * one depth and breaking silently in the other two contexts, try the
 * container's shape first (the default) and fall back to the monorepo shape
 * — both are cheap existsSync checks, and a service that can't find its own
 * pricing file should say so loudly (see loadPricing's throw), not guess.
 */
function resolvePricingPath(): string {
  const configured = config.checkout.pricingYamlPath;
  if (resolve(configured) === configured) return configured; // already absolute — trust it as-is

  const candidates = configured === '../../config/pricing.yaml'
    ? [configured, '../../../../config/pricing.yaml'] // default: try container shape, then monorepo shape
    : [configured];                                     // explicit override: exactly what was asked for, no fallback

  for (const candidate of candidates) {
    const abs = resolve(__dirname, candidate);
    if (existsSync(abs)) return abs;
  }
  return resolve(__dirname, candidates[0]!); // none exist — return the primary candidate so the error message is useful
}

export function loadPricing(forceReload = false): PricingConfig {
  if (cached && !forceReload) return cached;

  const path = resolvePricingPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(
      `[unified-router] Could not read pricing.yaml at ${path} (PRICING_YAML_PATH=${config.checkout.pricingYamlPath}). ` +
      `Checkout cannot price anything without it. Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsed = yaml.load(raw) as RawPricingYaml | undefined;
  if (!parsed?.tiers || typeof parsed.tiers !== 'object') {
    throw new Error(`[unified-router] pricing.yaml at ${path} has no top-level "tiers" map — cannot price checkout.`);
  }

  const tiers: Record<string, PricingTier> = {};
  for (const [key, t] of Object.entries(parsed.tiers)) {
    if (!t.fees?.card || !t.fees?.stablecoin || !t.fees?.crypto) {
      throw new Error(`[unified-router] pricing.yaml tier "${key}" is missing a fees.{card,stablecoin,crypto} block.`);
    }
    tiers[key] = {
      id:         t.id ?? key,
      name:       t.name ?? key,
      monthlyFee: t.monthly_fee,
      fees:       t.fees,
      limits:     t.limits ?? {},
      features:   t.features ?? {},
    };
  }

  cached = { tiers };
  return cached;
}

export type TierLookup =
  | { ok: true; tier: PricingTier }
  | { ok: false; reason: 'unknown_tier'; knownTiers: string[] };

/** Look up a tier by id from the request body — never trust a client-supplied price. */
export function getTier(tierId: string): TierLookup {
  const { tiers } = loadPricing();
  const tier = tiers[tierId];
  if (!tier) {
    return { ok: false, reason: 'unknown_tier', knownTiers: Object.keys(tiers) };
  }
  return { ok: true, tier };
}
