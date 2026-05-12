/**
 * Adapter factory.
 *
 * Returns a concrete adapter instance for the given protocol + chain
 * combination.  Throws if the combination is unsupported.
 *
 * Usage:
 *   const adapter = getAdapter('aave_v3', 'ethereum', provider);
 *   const apy     = await adapter.getCurrentApy();
 */

import { ethers } from 'ethers';
import { AaveAdapter } from './aave';
import { CompoundAdapter } from './compound';
import { OndoAdapter } from './ondo';
import type { Protocol, ChainName, BaseYieldAdapter } from '../types';
import { config } from '../config';

// ── Provider cache (one provider per chain) ───────────────────────────────────

const providerCache = new Map<ChainName, ethers.JsonRpcProvider>();

function getProvider(chain: ChainName): ethers.JsonRpcProvider {
  let p = providerCache.get(chain);
  if (!p) {
    const url = config.rpc[chain];
    p = new ethers.JsonRpcProvider(url);
    providerCache.set(chain, p);
  }
  return p;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Instantiate an adapter for the given protocol.
 *
 * @param protocol  Which yield protocol to use
 * @param chain     Target chain (required for on-chain adapters)
 * @param provider  Optional externally-managed provider (overrides the default)
 */
export function getAdapter(
  protocol: Protocol,
  chain: ChainName,
  provider?: ethers.Provider,
): BaseYieldAdapter {
  const p = provider ?? getProvider(chain);

  switch (protocol) {
    case 'aave_v3': {
      if (!AaveAdapter.isSupported(chain)) {
        throw new Error(`Aave V3 is not supported on chain: ${chain}`);
      }
      return new AaveAdapter(p, chain);
    }

    case 'compound_v3': {
      if (!CompoundAdapter.isSupported(chain)) {
        throw new Error(`Compound V3 is not supported on chain: ${chain}`);
      }
      return new CompoundAdapter(p, chain);
    }

    case 'ondo_usdy': {
      // Ondo uses an off-chain API; the provider is used only for balance
      // fallback queries.
      return new OndoAdapter(p, chain);
    }

    case 'superstate_ustb':
      // Superstate USTB integration is planned; stub for future implementation.
      throw new Error('Superstate USTB adapter is not yet implemented');

    case 'manual':
      throw new Error('Manual protocol does not have an on-chain adapter');

    default: {
      // Exhaustive check
      const _exhaustive: never = protocol;
      throw new Error(`Unknown protocol: ${String(_exhaustive)}`);
    }
  }
}

export { AaveAdapter } from './aave';
export { CompoundAdapter } from './compound';
export { OndoAdapter } from './ondo';
