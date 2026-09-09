/**
 * What a hard pull actually costs to serve.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The question this answers
 *
 * The volume bands price a pull at $2.80, $2.40 and $2.00. Nobody has ever
 * measured what one costs, so whether the deepest band is sold at a profit or a
 * loss is currently unknown — and the deepest band is the one the largest
 * customers land in, so an error there is an error on the biggest contracts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What is measured versus what must be supplied
 *
 * This module measures what a running process can actually observe: how many
 * sanctions screens a pull performed, how many chain reads, and how long it
 * held compute. Those are facts.
 *
 * It does not invent the price of any of them. A sanctions screen costs
 * whatever your vendor charges, an RPC read whatever your node provider
 * charges; those are contract terms, not properties of this code. They are
 * supplied as configuration, and when they are not supplied the summary reports
 * the volumes and declines to state a cost rather than filling in a number that
 * would look authoritative and be fictional.
 *
 * The distinction is the point. A made-up cost per pull is worse than no cost
 * per pull, because it would be used to sign a pricing decision.
 */

import { VOLUME_BANDS } from './plans';

// ── Configured unit prices ────────────────────────────────────────────────────
//
// All in USD. Unset means unknown, which is reported as unknown.

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export interface UnitPrices {
  /** What the sanctions vendor charges per screening call. */
  sanctionsScreenUsd?: number;
  /** What the node provider charges per JSON-RPC read. */
  chainReadUsd?: number;
  /** Fully-loaded compute cost per hour for the instance serving pulls. */
  computeHourUsd?: number;
}

/**
 * Prices set at runtime by an operator, which take precedence over the
 * environment.
 *
 * Vendor pricing is discovered from an invoice, not from a deploy: the first
 * real sanctions bill arrives weeks after the service is live, and requiring a
 * redeploy to record it is how the number never gets recorded at all. These are
 * held in memory and re-applied by the operator after a restart — deliberately
 * not persisted, because a stale price silently surviving a restart is worse
 * than an absent one that reports itself as absent.
 */
let overrides: UnitPrices = {};

export function setUnitPrices(next: UnitPrices): UnitPrices {
  overrides = {
    ...(next.sanctionsScreenUsd !== undefined ? { sanctionsScreenUsd: next.sanctionsScreenUsd } : {}),
    ...(next.chainReadUsd !== undefined ? { chainReadUsd: next.chainReadUsd } : {}),
    ...(next.computeHourUsd !== undefined ? { computeHourUsd: next.computeHourUsd } : {}),
  };
  return unitPrices();
}

/** Test seam, and the way an operator clears a price they set by mistake. */
export function clearUnitPriceOverrides(): void {
  overrides = {};
}

/** Where each price came from, so a margin figure can be traced to its source. */
export function unitPriceSources(): Record<string, 'operator' | 'environment' | 'unset'> {
  const src = (key: keyof UnitPrices, env: string) =>
    overrides[key] !== undefined ? 'operator' as const
    : envNumber(env) !== undefined ? 'environment' as const
    : 'unset' as const;
  return {
    sanctionsScreenUsd: src('sanctionsScreenUsd', 'COST_SANCTIONS_SCREEN_USD'),
    chainReadUsd:       src('chainReadUsd', 'COST_CHAIN_READ_USD'),
    computeHourUsd:     src('computeHourUsd', 'COST_COMPUTE_HOUR_USD'),
  };
}

export function unitPrices(): UnitPrices {
  const fromEnv: UnitPrices = {
    ...(envNumber('COST_SANCTIONS_SCREEN_USD') !== undefined
      ? { sanctionsScreenUsd: envNumber('COST_SANCTIONS_SCREEN_USD')! } : {}),
    ...(envNumber('COST_CHAIN_READ_USD') !== undefined
      ? { chainReadUsd: envNumber('COST_CHAIN_READ_USD')! } : {}),
    ...(envNumber('COST_COMPUTE_HOUR_USD') !== undefined
      ? { computeHourUsd: envNumber('COST_COMPUTE_HOUR_USD')! } : {}),
  };
  // Operator values win: they came from an invoice, the environment came from
  // a deploy manifest that may predate it.
  return { ...fromEnv, ...overrides };
}

/**
 * Validate a price the operator is trying to set.
 *
 * A negative or non-finite price would flow straight into a margin figure and
 * out into a pricing decision, so it is rejected rather than coerced.
 */
export function validateUnitPrice(field: string, value: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return `${field} must be a non-negative number`;
  }
  return null;
}

// ── Per-pull measurement ──────────────────────────────────────────────────────

export interface PullCostSample {
  reportId: string;
  requestorId: string;
  sanctionsScreens: number;
  chainReads: number;
  computeMs: number;
  at: string;
}

/**
 * A recorder for one pull.
 *
 * Deliberately not a global counter incremented from arbitrary call sites: a
 * cost has to be attributable to the pull that incurred it, or the average is
 * the only thing you can ever compute and the expensive tail stays invisible.
 */
export class PullCostSpan {
  private sanctions = 0;
  private reads = 0;
  private readonly startedAt = Date.now();

  sanctionsScreen(n = 1): void { this.sanctions += n; }
  chainRead(n = 1): void { this.reads += n; }

  finish(reportId: string, requestorId: string, now = new Date()): PullCostSample {
    const sample: PullCostSample = {
      reportId,
      requestorId,
      sanctionsScreens: this.sanctions,
      chainReads: this.reads,
      computeMs: Date.now() - this.startedAt,
      at: now.toISOString(),
    };
    record(sample);
    return sample;
  }
}

export function startPullCost(): PullCostSpan {
  return new PullCostSpan();
}

// ── Rolling window ────────────────────────────────────────────────────────────
//
// Bounded on purpose. This is an operational signal, not an audit ledger; the
// attribution ledger is where per-inquiry records belong. An unbounded array
// here would be a slow memory leak on the hottest path in the service.

const MAX_SAMPLES = Number(process.env['PULL_COST_WINDOW'] ?? '5000');
const samples: PullCostSample[] = [];

function record(sample: PullCostSample): void {
  samples.push(sample);
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);
}

/** Test seam. */
export function resetPullCosts(): void { samples.length = 0; }
export function pullCostSamples(): readonly PullCostSample[] { return samples; }

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx]!;
}

// ── Summary ───────────────────────────────────────────────────────────────────

export interface BandMargin {
  pricePerPullUsd: number;
  upTo: number;
  /** Undefined when unit prices are not configured — unknown, not zero. */
  costPerPullUsd?: number;
  marginPerPullUsd?: number;
  marginPct?: number;
  profitable?: boolean;
}

export interface PullCostSummary {
  samples: number;
  volumes: {
    sanctionsScreensPerPull: number;
    chainReadsPerPull: number;
    computeMsMean: number;
    computeMsP50: number;
    computeMsP95: number;
  };
  unitPrices: UnitPrices;
  /** Which unit prices are missing; while non-empty, cost figures are absent. */
  missingUnitPrices: string[];
  costPerPullUsd?: number;
  costPerPullP95Usd?: number;
  bands: BandMargin[];
}

function costOf(sanctions: number, reads: number, computeMs: number, p: UnitPrices): number | undefined {
  if (p.sanctionsScreenUsd === undefined || p.chainReadUsd === undefined || p.computeHourUsd === undefined) {
    return undefined;
  }
  return sanctions * p.sanctionsScreenUsd
       + reads * p.chainReadUsd
       + (computeMs / 3_600_000) * p.computeHourUsd;
}

/**
 * Cost per pull and the margin at each volume band.
 *
 * Margins are reported per band rather than as one blended number because the
 * bands are the decision: a pull is sold at $2.80 or at $2.00 depending on the
 * customer's volume, and only the cheapest band can tell you whether the
 * discount is still above cost.
 */
export function pullCostSummary(): PullCostSummary {
  const n = samples.length;
  const prices = unitPrices();

  const missing: string[] = [];
  if (prices.sanctionsScreenUsd === undefined) missing.push('COST_SANCTIONS_SCREEN_USD');
  if (prices.chainReadUsd === undefined) missing.push('COST_CHAIN_READ_USD');
  if (prices.computeHourUsd === undefined) missing.push('COST_COMPUTE_HOUR_USD');

  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const computeMs = samples.map(s => s.computeMs).sort((a, b) => a - b);

  const volumes = {
    sanctionsScreensPerPull: mean(samples.map(s => s.sanctionsScreens)),
    chainReadsPerPull:       mean(samples.map(s => s.chainReads)),
    computeMsMean:           mean(samples.map(s => s.computeMs)),
    computeMsP50:            percentile(computeMs, 50),
    computeMsP95:            percentile(computeMs, 95),
  };

  const costPerPull = n === 0 ? undefined
    : costOf(volumes.sanctionsScreensPerPull, volumes.chainReadsPerPull, volumes.computeMsMean, prices);

  // p95 cost uses p95 compute against mean call volumes: the tail this service
  // actually has is latency, not a pull that suddenly screens twice.
  const costP95 = n === 0 ? undefined
    : costOf(volumes.sanctionsScreensPerPull, volumes.chainReadsPerPull, volumes.computeMsP95, prices);

  const bands: BandMargin[] = VOLUME_BANDS.map(b => {
    const base: BandMargin = { pricePerPullUsd: b.pricePerPullUsd, upTo: b.upTo };
    if (costPerPull === undefined) return base;
    const marginUsd = b.pricePerPullUsd - costPerPull;
    return {
      ...base,
      costPerPullUsd: costPerPull,
      marginPerPullUsd: marginUsd,
      marginPct: (marginUsd / b.pricePerPullUsd) * 100,
      profitable: marginUsd > 0,
    };
  });

  return {
    samples: n,
    volumes,
    unitPrices: prices,
    missingUnitPrices: missing,
    ...(costPerPull !== undefined ? { costPerPullUsd: costPerPull } : {}),
    ...(costP95 !== undefined ? { costPerPullP95Usd: costP95 } : {}),
    bands,
  };
}
