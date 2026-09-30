/**
 * What the routes and the settlement loop share: the asset registry, the rate
 * store and a way to read each chain. Created lazily over the gateway's real
 * database and RPC endpoints; tests replace it.
 */

import { ethers } from 'ethers';
import { assetRegistry, type AssetRegistry } from './assets.js';
import { dbRateStore, type RateStore } from './fx.js';
import { RpcSettlementChain, type SettlementChain } from './settlement.js';

export interface GatewayContext {
  registry: AssetRegistry;
  rates: RateStore;
  /** Current block on a chain, or null if it can't be read. */
  currentBlock(chain: string): Promise<number | null>;
  chainApi(chain: string): SettlementChain | null;
}

let override: GatewayContext | null = null;
export function setGatewayContext(c: GatewayContext | null): void { override = c; }

const chainApis = new Map<string, RpcSettlementChain>();

export function rpcChainApi(chain: string, rpcUrl: string | undefined): SettlementChain | null {
  if (!rpcUrl) return null;
  let api = chainApis.get(chain);
  if (!api) {
    const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, { staticNetwork: false });
    provider.on('error', () => undefined);
    api = new RpcSettlementChain(provider);
    chainApis.set(chain, api);
  }
  return api;
}

export async function gatewayContext(): Promise<GatewayContext> {
  if (override) return override;
  const [{ config }, { getDb }] = await Promise.all([import('../config.js'), import('./db.js')]);
  const registry = await assetRegistry();
  const rpc = config.rpc as Record<string, string>;
  return {
    registry,
    rates: dbRateStore(() => getDb() as never),
    currentBlock: async (chain) => rpcChainApi(chain, rpc[chain])?.blockNumber().catch(() => null) ?? null,
    chainApi: (chain) => rpcChainApi(chain, rpc[chain]),
  };
}
