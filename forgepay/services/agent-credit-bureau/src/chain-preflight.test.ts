/**
 * Chain preflight.
 *
 * The scenario under test is a mainnet rollout that is entirely plausible and
 * entirely wrong: RPC, contract addresses and a signing key all set, CHAIN_ID
 * left at its default. Nothing errors, Mode 2 keeps settling, and every score
 * carries a transaction hash pointing at a testnet. A lender reading it cannot
 * tell the difference — which is why these checks throw rather than warn.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  assertChainConfigured, ChainPreflightError, chainIdWasExplicit,
  isTestnet, chainName, runChainPreflight, formatPreflight,
} from './chain-preflight';

const ORIGINAL_ENV = { ...process.env };

const ADDR = '0x1234567890123456789012345678901234567890';

function productionChainEnv(over: Record<string, string> = {}) {
  process.env['NODE_ENV'] = 'production';
  process.env['CHAIN_RPC_URL'] = 'https://base.example.invalid';
  process.env['CHAIN_ID'] = '8453';
  process.env['FORGE_REGISTRY_ADDRESS'] = ADDR;
  process.env['FORGE_VALIDATOR_ADDRESS'] = ADDR;
  process.env['FORGE_ENFORCER_ADDRESS'] = ADDR;
  process.env['FORGE_CORE_ADDRESS'] = ADDR;
  Object.assign(process.env, over);
}

beforeEach(() => { process.env = { ...ORIGINAL_ENV }; });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; });

describe('assertChainConfigured', () => {
  it('refuses production with an RPC but no explicit CHAIN_ID', () => {
    // The exact shape of the rollout this guard exists for.
    productionChainEnv();
    delete process.env['CHAIN_ID'];
    expect(() => assertChainConfigured()).toThrow(ChainPreflightError);
    expect(() => assertChainConfigured()).toThrow(/defaults to 84532/);
  });

  it('refuses a testnet chain id in production unless deliberately allowed', () => {
    productionChainEnv({ CHAIN_ID: '84532' });
    expect(() => assertChainConfigured()).toThrow(/Base Sepolia/);

    process.env['ALLOW_TESTNET_IN_PRODUCTION'] = 'true';
    expect(() => assertChainConfigured()).not.toThrow();
  });

  it('accepts an explicit mainnet configuration', () => {
    productionChainEnv({ CHAIN_ID: '8453' });
    expect(() => assertChainConfigured()).not.toThrow();
  });

  it('rejects a malformed chain id', () => {
    productionChainEnv({ CHAIN_ID: 'mainnet' });
    expect(() => assertChainConfigured()).toThrow(/not a valid chain id/);
  });

  it('leaves an off-chain-only deployment alone', () => {
    // Running Mode 1 with no chain bridge is a supported mode, not a
    // misconfiguration. This guard is for the half-configured case.
    process.env['NODE_ENV'] = 'production';
    delete process.env['CHAIN_RPC_URL'];
    delete process.env['CHAIN_ID'];
    expect(() => assertChainConfigured()).not.toThrow();
  });

  it('does not interfere outside production', () => {
    process.env['NODE_ENV'] = 'development';
    process.env['CHAIN_RPC_URL'] = 'http://localhost:8545';
    delete process.env['CHAIN_ID'];
    expect(() => assertChainConfigured()).not.toThrow();
  });

  it('knows which ids are testnets', () => {
    expect(isTestnet(84532)).toBe(true);
    expect(isTestnet(8453)).toBe(false);
    expect(chainName(8453)).toMatch(/Base mainnet/);
  });

  it('distinguishes an unset CHAIN_ID from an empty one', () => {
    delete process.env['CHAIN_ID'];
    expect(chainIdWasExplicit()).toBe(false);
    process.env['CHAIN_ID'] = '   ';
    expect(chainIdWasExplicit()).toBe(false);
    process.env['CHAIN_ID'] = '8453';
    expect(chainIdWasExplicit()).toBe(true);
  });
});

describe('runChainPreflight', () => {
  function client(over: Partial<{
    chainId: number; rpcChainId: number; code: string; balance: bigint;
  }> = {}) {
    const { chainId = 8453, rpcChainId = 8453, code = '0x6080', balance = 10n ** 18n } = over;
    return {
      chainId,
      address: ADDR,
      publicClient: () => ({
        getChainId: async () => rpcChainId,
        getBytecode: async () => code,
        getBalance: async () => balance,
      }),
    };
  }

  it('passes a correctly configured mainnet deployment', async () => {
    productionChainEnv();
    const r = await runChainPreflight(client());
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it('catches an RPC on a different network than the configured chain id', async () => {
    // Self-consistent configuration, completely wrong — the case a
    // config-only check can never see.
    productionChainEnv();
    const r = await runChainPreflight(client({ chainId: 8453, rpcChainId: 84532 }));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/One of them is wrong/);
  });

  it('catches contract addresses with no code on this chain', async () => {
    // What a testnet address looks like once it is carried into a mainnet config.
    productionChainEnv();
    const r = await runChainPreflight(client({ code: '0x' }));
    expect(r.ok).toBe(false);
    expect(r.problems.filter((p) => p.includes('no contract code'))).toHaveLength(4);
  });

  it('catches an unfunded settlement wallet', async () => {
    productionChainEnv();
    const r = await runChainPreflight(client({ balance: 0n }));
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/cannot pay gas/);
  });

  it('reports every problem at once rather than the first', async () => {
    // An operator fixing a rollout wants the whole list, not one per restart.
    productionChainEnv();
    delete process.env['FORGE_CORE_ADDRESS'];
    const r = await runChainPreflight(client({ rpcChainId: 84532, code: '0x', balance: 0n }));
    expect(r.problems.length).toBeGreaterThan(3);
  });

  it('renders a readable report', async () => {
    productionChainEnv();
    const out = formatPreflight(await runChainPreflight(client({ balance: 0n })));
    expect(out).toMatch(/Mode 2 chain preflight/);
    expect(out).toMatch(/Base mainnet/);
    expect(out).toMatch(/problem\(s\)/);
  });
});
