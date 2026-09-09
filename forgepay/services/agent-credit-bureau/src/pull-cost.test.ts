/**
 * Cost instrumentation.
 *
 * The assertion that matters most is the one about absence: with no vendor unit
 * prices configured, the summary must report volumes and withhold cost. A
 * fabricated cost per pull would be used to sign a pricing decision, which
 * makes a plausible wrong number strictly worse than a missing one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  startPullCost, pullCostSummary, resetPullCosts, pullCostSamples, unitPrices,
} from './pull-cost';
import { VOLUME_BANDS } from './plans';

const ORIGINAL_ENV = { ...process.env };

function setPrices(sanctions: string, read: string, computeHour: string) {
  process.env['COST_SANCTIONS_SCREEN_USD'] = sanctions;
  process.env['COST_CHAIN_READ_USD'] = read;
  process.env['COST_COMPUTE_HOUR_USD'] = computeHour;
}

beforeEach(() => {
  resetPullCosts();
  process.env = { ...ORIGINAL_ENV };
  delete process.env['COST_SANCTIONS_SCREEN_USD'];
  delete process.env['COST_CHAIN_READ_USD'];
  delete process.env['COST_COMPUTE_HOUR_USD'];
});

afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('measuring a pull', () => {
  it('records call volumes against the pull that incurred them', () => {
    const span = startPullCost();
    span.sanctionsScreen();
    span.chainRead(3);
    const sample = span.finish('rep_1', 'req_1');

    expect(sample.sanctionsScreens).toBe(1);
    expect(sample.chainReads).toBe(3);
    expect(sample.computeMs).toBeGreaterThanOrEqual(0);
    expect(pullCostSamples()).toHaveLength(1);
  });

  it('keeps the window bounded so the hot path cannot leak memory', () => {
    // The default window is 5000; pushing past it must evict rather than grow.
    for (let i = 0; i < 20; i++) startPullCost().finish(`rep_${i}`, 'req');
    expect(pullCostSamples().length).toBeLessThanOrEqual(20);
    expect(pullCostSamples().length).toBeGreaterThan(0);
  });
});

describe('unconfigured unit prices', () => {
  it('reports nothing for cost rather than a fabricated zero', () => {
    startPullCost().finish('rep_1', 'req_1');
    const s = pullCostSummary();

    expect(s.costPerPullUsd).toBeUndefined();
    expect(s.costPerPullP95Usd).toBeUndefined();
    expect(s.missingUnitPrices).toEqual([
      'COST_SANCTIONS_SCREEN_USD', 'COST_CHAIN_READ_USD', 'COST_COMPUTE_HOUR_USD',
    ]);
    for (const band of s.bands) {
      expect(band.costPerPullUsd).toBeUndefined();
      expect(band.profitable).toBeUndefined();
    }
  });

  it('still reports the measured volumes, which are real regardless of pricing', () => {
    const span = startPullCost();
    span.sanctionsScreen();
    span.chainRead(2);
    span.finish('rep_1', 'req_1');

    const s = pullCostSummary();
    expect(s.samples).toBe(1);
    expect(s.volumes.sanctionsScreensPerPull).toBe(1);
    expect(s.volumes.chainReadsPerPull).toBe(2);
  });

  it('treats a partially configured price set as unconfigured', () => {
    // Two of three is not enough to compute a cost, and quietly treating the
    // missing one as zero would understate cost on every band.
    process.env['COST_SANCTIONS_SCREEN_USD'] = '0.50';
    process.env['COST_CHAIN_READ_USD'] = '0.0001';
    startPullCost().finish('rep_1', 'req_1');

    const s = pullCostSummary();
    expect(s.costPerPullUsd).toBeUndefined();
    expect(s.missingUnitPrices).toEqual(['COST_COMPUTE_HOUR_USD']);
  });

  it('ignores a malformed or negative price rather than trusting it', () => {
    process.env['COST_SANCTIONS_SCREEN_USD'] = 'not-a-number';
    process.env['COST_CHAIN_READ_USD'] = '-1';
    expect(unitPrices().sanctionsScreenUsd).toBeUndefined();
    expect(unitPrices().chainReadUsd).toBeUndefined();
  });
});

describe('configured unit prices', () => {
  it('computes cost from the measured volumes', () => {
    setPrices('0.50', '0.001', '0'); // compute priced at zero to make the arithmetic exact
    const span = startPullCost();
    span.sanctionsScreen();
    span.chainRead(10);
    span.finish('rep_1', 'req_1');

    const s = pullCostSummary();
    expect(s.costPerPullUsd).toBeCloseTo(0.5 + 0.01, 6);
  });

  it('reports margin per band, so the deepest discount can be judged on its own', () => {
    setPrices('0.50', '0', '0');
    const span = startPullCost();
    span.sanctionsScreen();
    span.finish('rep_1', 'req_1');

    const s = pullCostSummary();
    expect(s.bands).toHaveLength(VOLUME_BANDS.length);
    for (const band of s.bands) {
      expect(band.marginPerPullUsd).toBeCloseTo(band.pricePerPullUsd - 0.5, 6);
      expect(band.profitable).toBe(true);
    }
  });

  it('flags a band sold below cost', () => {
    // The question the module exists to answer: at $2.00 the deepest band is
    // the first to go underwater, and it must say so rather than blending it
    // away against the $2.80 band.
    setPrices('2.50', '0', '0');
    const span = startPullCost();
    span.sanctionsScreen();
    span.finish('rep_1', 'req_1');

    const s = pullCostSummary();
    const cheapest = s.bands.reduce((a, b) => (b.pricePerPullUsd < a.pricePerPullUsd ? b : a));
    const dearest = s.bands.reduce((a, b) => (b.pricePerPullUsd > a.pricePerPullUsd ? b : a));

    expect(cheapest.profitable).toBe(false);
    expect(dearest.profitable).toBe(true);
  });

  it('reports no cost when nothing has been measured yet', () => {
    setPrices('0.50', '0.001', '0.10');
    const s = pullCostSummary();
    expect(s.samples).toBe(0);
    expect(s.costPerPullUsd).toBeUndefined();
  });
});
