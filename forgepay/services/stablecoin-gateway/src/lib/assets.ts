/**
 * The stablecoins this gateway moves: USDC, ZARP (rand) and OUSD.
 *
 * Which token contract is which, and how many decimals it has, decides whether a
 * payment is credited correctly — a wrong decimals value is off by a power of
 * ten. So nothing about a token is taken on trust:
 *
 *   - The contract addresses below (or from ASSET_<SYMBOL>_<CHAIN> in the
 *     environment) are what the operator *intends*.
 *   - At start-up, and on demand, each is checked against the chain: there must
 *     be code at the address, its `symbol()` must be the expected one, and its
 *     `decimals()` is read from it. An RPC pointing at the wrong network is
 *     caught by checking the chain id first.
 *   - An asset that fails, or that hasn't been checked yet, is *unavailable*:
 *     the gateway refuses to quote or pay in it rather than guess.
 *
 * USDC is the one exception on the "not yet checked" rule: its addresses and its
 * 6 decimals are canonical and were already built into this gateway, so it stays
 * usable (marked unverified) if the RPC is briefly unreachable at start-up.
 */

import { ethers } from 'ethers';

export type AssetSymbol = 'USDC' | 'USDT' | 'ZARP' | 'OUSD';
/** What one whole token is pegged to. */
export type PegUnit = 'USD' | 'ZAR';

export const ASSET_SYMBOLS: readonly AssetSymbol[] = ['USDC', 'USDT', 'ZARP', 'OUSD'];

export interface AssetDef {
  symbol: AssetSymbol;
  name: string;
  unit: PegUnit;
  /** Decimals that may be used without an on-chain read (USDC only). */
  presetDecimals?: number;
  /** Symbols the contract may report; anything else means the address is wrong. */
  expectedSymbols: string[];
  /** chain → contract address */
  chains: Record<string, string>;
}

export const DEFAULT_ASSETS: AssetDef[] = [
  {
    symbol: 'USDC', name: 'USD Coin', unit: 'USD', presetDecimals: 6, expectedSymbols: ['USDC'],
    chains: {
      ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      polygon: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      base: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    },
  },
  {
    // Kept so existing USDT deposits (ethereum, polygon, arbitrum) carry on being detected.
    symbol: 'USDT', name: 'Tether USD', unit: 'USD', presetDecimals: 6, expectedSymbols: ['USDT', 'USD₮0', 'USDT0'],
    chains: {
      ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
      polygon: '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
      arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
    },
  },
  {
    symbol: 'ZARP', name: 'ZARP Stablecoin (South African rand)', unit: 'ZAR', expectedSymbols: ['ZARP'],
    chains: { base: '0xb755506531786C8aC63B756BaB1ac387bACB0C04' },
  },
  {
    symbol: 'OUSD', name: 'Open Standard USD', unit: 'USD', expectedSymbols: ['OUSD'],
    chains: { base: '0xB2000000000000000000002fEb517dFeC7415344' },
  },
];

export const CHAIN_IDS: Record<string, number> = { ethereum: 1, polygon: 137, base: 8453, arbitrum: 42161 };

/** Apply ASSET_<SYMBOL>_<CHAIN>=<address|off> and ASSETS_ENABLED to the defaults. */
export function loadAssetDefs(env: NodeJS.ProcessEnv = process.env): AssetDef[] {
  const enabled = (env['ASSETS_ENABLED'] ?? ASSET_SYMBOLS.join(','))
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  return DEFAULT_ASSETS
    .filter((d) => enabled.includes(d.symbol))
    .map((d) => {
      const chains: Record<string, string> = { ...d.chains };
      for (const chain of new Set([...Object.keys(d.chains), ...Object.keys(CHAIN_IDS)])) {
        const v = env[`ASSET_${d.symbol}_${chain.toUpperCase()}`];
        if (v === undefined || v === '') continue;
        if (v.toLowerCase() === 'off') delete chains[chain];
        else if (ethers.isAddress(v)) chains[chain] = ethers.getAddress(v.toLowerCase());
        else throw new Error(`ASSET_${d.symbol}_${chain.toUpperCase()}="${v}" is not an address`);
      }
      return { ...d, chains };
    });
}

// ── Reading a token ───────────────────────────────────────────────────────────

export interface TokenReader {
  chainId(chain: string): Promise<number>;
  hasCode(chain: string, address: string): Promise<boolean>;
  symbol(chain: string, address: string): Promise<string>;
  decimals(chain: string, address: string): Promise<number>;
  blockNumber?(chain: string): Promise<number>;
}

const ERC20_READ_ABI = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
];

/** Reads tokens over JSON-RPC, using the same per-chain endpoints as the rest of the gateway. */
export class RpcTokenReader implements TokenReader {
  private providers = new Map<string, ethers.JsonRpcProvider>();
  constructor(private readonly rpc: Record<string, string>) {}

  private provider(chain: string): ethers.JsonRpcProvider {
    const url = this.rpc[chain];
    if (!url) throw new Error(`no RPC endpoint is configured for ${chain}`);
    let p = this.providers.get(chain);
    if (!p) {
      p = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: false });
      p.on('error', () => undefined);
      this.providers.set(chain, p);
    }
    return p;
  }
  async chainId(chain: string) { return Number((await this.provider(chain).getNetwork()).chainId); }
  async hasCode(chain: string, address: string) { return (await this.provider(chain).getCode(address)) !== '0x'; }
  async symbol(chain: string, address: string) {
    return String(await new ethers.Contract(address, ERC20_READ_ABI, this.provider(chain))['symbol']!());
  }
  async decimals(chain: string, address: string) {
    return Number(await new ethers.Contract(address, ERC20_READ_ABI, this.provider(chain))['decimals']!());
  }
  async blockNumber(chain: string) { return this.provider(chain).getBlockNumber(); }
}

// ── The registry ──────────────────────────────────────────────────────────────

export interface ChainAsset {
  symbol: AssetSymbol;
  name: string;
  chain: string;
  address: string;
  unit: PegUnit;
  decimals: number;
  /** true once symbol, decimals and chain were confirmed on-chain. */
  verified: boolean;
}

export interface AssetStatus {
  symbol: AssetSymbol;
  chain: string;
  address: string;
  unit: PegUnit;
  decimals: number | null;
  status: 'available' | 'unverified' | 'unavailable';
  problem?: string;
}

export class AssetRegistry {
  private usable = new Map<string, ChainAsset>();
  private statuses = new Map<string, AssetStatus>();
  private verifiedOnce = false;

  constructor(
    private readonly defs: AssetDef[] = loadAssetDefs(),
    private readonly reader: TokenReader,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  private key(symbol: string, chain: string) { return `${symbol}:${chain}`; }

  private expectedChainId(chain: string): number | undefined {
    const override = this.env[`${chain.toUpperCase()}_CHAIN_ID`];
    return override ? Number(override) : CHAIN_IDS[chain];
  }

  /** Check every configured asset against the chain. Safe to call repeatedly. */
  async verify(): Promise<AssetStatus[]> {
    const chainOk = new Map<string, string | null>(); // chain → problem, or null when the RPC is the right network
    const next = new Map<string, ChainAsset>();
    const statuses = new Map<string, AssetStatus>();

    for (const def of this.defs) {
      for (const [chain, address] of Object.entries(def.chains)) {
        const k = this.key(def.symbol, chain);
        const base = { symbol: def.symbol, chain, address, unit: def.unit };
        const pinnedRaw = this.env[`ASSET_${def.symbol}_${chain.toUpperCase()}_DECIMALS`];
        const pinned = pinnedRaw !== undefined && pinnedRaw !== '' ? Number(pinnedRaw) : def.presetDecimals;

        let problem: string | null = null;
        let decimals: number | null = null;
        try {
          if (!chainOk.has(chain)) {
            const want = this.expectedChainId(chain);
            const got = await this.reader.chainId(chain);
            chainOk.set(chain, want !== undefined && got !== want ? `the ${chain} RPC reports chain id ${got}, expected ${want}` : null);
          }
          problem = chainOk.get(chain) ?? null;
          if (!problem && !(await this.reader.hasCode(chain, address))) problem = `no contract at ${address} on ${chain}`;
          if (!problem) {
            const sym = await this.reader.symbol(chain, address);
            if (!def.expectedSymbols.map((s) => s.toUpperCase()).includes(sym.toUpperCase())) {
              problem = `the contract at ${address} calls itself "${sym}", not ${def.expectedSymbols.join('/')}`;
            } else {
              decimals = await this.reader.decimals(chain, address);
              if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) problem = `implausible decimals (${decimals})`;
              else if (pinned !== undefined && decimals !== pinned) problem = `the contract reports ${decimals} decimals, configured ${pinned}`;
            }
          }
        } catch (err) {
          // Couldn't read the chain at all: only an asset with canonical built-in decimals may carry on, unverified.
          if (def.presetDecimals !== undefined && pinned !== undefined) {
            const ca: ChainAsset = { symbol: def.symbol, name: def.name, chain, address, unit: def.unit, decimals: pinned, verified: false };
            next.set(k, ca);
            statuses.set(k, { ...base, decimals: pinned, status: 'unverified', problem: `could not verify on-chain: ${(err as Error).message}` });
            continue;
          }
          problem = `could not verify on-chain: ${(err as Error).message}`;
        }

        if (problem || decimals === null) {
          statuses.set(k, { ...base, decimals: null, status: 'unavailable', problem: problem ?? 'unverified' });
          continue;
        }
        next.set(k, { symbol: def.symbol, name: def.name, chain, address, unit: def.unit, decimals, verified: true });
        statuses.set(k, { ...base, decimals, status: 'available' });
      }
    }
    this.usable = next;
    this.statuses = statuses;
    this.verifiedOnce = true;
    return [...statuses.values()];
  }

  /** The asset on that chain if it may be used, else undefined. */
  get(symbol: string, chain: string): ChainAsset | undefined {
    return this.usable.get(this.key(symbol.toUpperCase(), chain));
  }

  /** Why an asset can't be used, for an error message. */
  whyNot(symbol: string, chain: string): string {
    const s = this.statuses.get(this.key(symbol.toUpperCase(), chain));
    if (s) return s.problem ?? `${symbol} on ${chain} is not available`;
    if (!this.verifiedOnce) return 'assets have not been verified yet';
    return `${symbol} is not configured on ${chain}`;
  }

  available(): ChainAsset[] { return [...this.usable.values()]; }
  status(): AssetStatus[] { return [...this.statuses.values()]; }
  chains(): string[] { return [...new Set(this.defs.flatMap((d) => Object.keys(d.chains)))]; }
}

// ── The process-wide registry ─────────────────────────────────────────────────

let shared: AssetRegistry | null = null;

export function setAssetRegistry(r: AssetRegistry | null): void { shared = r; }

/** The registry for this process, created on first use over the gateway's RPC endpoints. */
export async function assetRegistry(): Promise<AssetRegistry> {
  if (!shared) {
    const { config } = await import('../config.js');
    shared = new AssetRegistry(loadAssetDefs(), new RpcTokenReader(config.rpc as Record<string, string>));
  }
  return shared;
}
