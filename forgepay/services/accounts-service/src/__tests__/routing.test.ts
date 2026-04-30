import { describe, it, expect } from 'vitest';
import { RoutingManager } from '../lib/routing-manager.js';

describe('RoutingManager', () => {
  const rm = new RoutingManager();

  it('routes small amounts to polygon direct-blockchain', () => {
    const route = rm.selectRoute({ amountUsd: 50, merchantId: 'm1', accountId: 'a1' });
    expect(route.chain).toBe('polygon');
    expect(route.supplier).toBe('direct-blockchain');
    expect(route.estimatedFeeUsd).toBeLessThan(1);
  });

  it('routes medium amounts via circle on polygon', () => {
    const route = rm.selectRoute({ amountUsd: 500, merchantId: 'm1', accountId: 'a1' });
    expect(route.supplier).toBe('circle');
    expect(route.chain).toBe('polygon');
  });

  it('routes large amounts via circle on ethereum', () => {
    const route = rm.selectRoute({ amountUsd: 15_000, merchantId: 'm1', accountId: 'a1' });
    expect(route.supplier).toBe('circle');
    expect(route.chain).toBe('ethereum');
  });

  it('fast urgency routes to base direct-blockchain', () => {
    const route = rm.selectRoute({ amountUsd: 500, merchantId: 'm1', accountId: 'a1', urgency: 'fast' });
    expect(route.chain).toBe('base');
    expect(route.supplier).toBe('direct-blockchain');
    expect(route.estimatedTimeSeconds).toBeLessThan(30);
  });

  it('respects preferredChain override for small amounts', () => {
    const route = rm.selectRoute({ amountUsd: 50, merchantId: 'm1', accountId: 'a1', preferredChain: 'arbitrum' });
    expect(route.chain).toBe('arbitrum');
    expect(route.supplier).toBe('direct-blockchain');
  });

  it('respects preferredChain override for large amounts', () => {
    const route = rm.selectRoute({ amountUsd: 20_000, merchantId: 'm1', accountId: 'a1', preferredChain: 'base' });
    expect(route.chain).toBe('base');
    expect(route.supplier).toBe('circle');
  });

  it('fast urgency with preferredChain uses preferred chain', () => {
    const route = rm.selectRoute({ amountUsd: 100, merchantId: 'm1', accountId: 'a1', urgency: 'fast', preferredChain: 'polygon' });
    expect(route.chain).toBe('polygon');
    expect(route.supplier).toBe('direct-blockchain');
  });

  it('returns USDC as default token', () => {
    const route = rm.selectRoute({ amountUsd: 100, merchantId: 'm1', accountId: 'a1' });
    expect(route.token).toBe('USDC');
  });

  it('includes fee and time estimates', () => {
    const route = rm.selectRoute({ amountUsd: 50, merchantId: 'm1', accountId: 'a1' });
    expect(route.estimatedFeeUsd).toBeGreaterThan(0);
    expect(route.estimatedTimeSeconds).toBeGreaterThan(0);
  });
});
