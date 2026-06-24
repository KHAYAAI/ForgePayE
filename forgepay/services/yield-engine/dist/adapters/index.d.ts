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
import type { Protocol, ChainName, BaseYieldAdapter } from '../types';
/**
 * Instantiate an adapter for the given protocol.
 *
 * @param protocol  Which yield protocol to use
 * @param chain     Target chain (required for on-chain adapters)
 * @param provider  Optional externally-managed provider (overrides the default)
 */
export declare function getAdapter(protocol: Protocol, chain: ChainName, provider?: ethers.Provider): BaseYieldAdapter;
export { AaveAdapter } from './aave';
export { CompoundAdapter } from './compound';
export { OndoAdapter } from './ondo';
//# sourceMappingURL=index.d.ts.map