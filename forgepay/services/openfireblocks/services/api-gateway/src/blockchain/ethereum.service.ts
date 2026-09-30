import { Injectable, Logger } from '@nestjs/common';
import { ethers } from 'ethers';

export interface NetworkInfo {
  chainId: number;
  name: string;
}

const KNOWN_NETWORKS: Record<number, string> = {
  1: 'Ethereum mainnet',
  11155111: 'Sepolia',
  17000: 'Holesky',
  137: 'Polygon',
  8453: 'Base',
  1337: 'Local dev chain (ganache)',
  31337: 'Local dev chain',
};

/**
 * Thin wrapper around one Ethereum JSON-RPC endpoint.
 *
 * The RPC URL comes from ETHEREUM_RPC_URL (or the older ETHEREUM_RPC_SEPOLIA).
 * The chain id is never assumed: it is asked of the node (eth_chainId) the
 * first time the RPC answers, and the provider is pinned to that answer, so the
 * gateway's chain id always matches the network it is really talking to.
 * If the node is down at start-up nothing crashes; the next call retries.
 */
@Injectable()
export class EthereumService {
  private readonly logger = new Logger(EthereumService.name);
  private provider: ethers.JsonRpcProvider | null = null;
  private network: NetworkInfo | null = null;

  private get rpcUrl(): string | null {
    const url = process.env.ETHEREUM_RPC_URL || process.env.ETHEREUM_RPC_SEPOLIA;
    if (!url || url.includes('YOUR_KEY')) return null;
    return url;
  }

  constructor() {
    if (!this.rpcUrl) {
      // Without an RPC the gateway still signs and audits; it just can't move
      // anything on a network. The console says so.
      this.logger.warn('no Ethereum RPC configured (ETHEREUM_RPC_URL); signing only, nothing will be broadcast');
    } else {
      this.logger.log(`Ethereum RPC configured: ${this.rpcUrl}`);
    }
  }

  /** True when an RPC endpoint is configured (it may still be unreachable right now). */
  get canBroadcast(): boolean {
    return this.rpcUrl !== null;
  }

  /** Detect the node's chain id and pin a provider to it. Throws if the node doesn't answer. */
  private async connect(): Promise<ethers.JsonRpcProvider> {
    if (this.provider) return this.provider;
    const url = this.rpcUrl;
    if (!url) throw new Error('Ethereum RPC not configured');
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
        signal: AbortSignal.timeout(4000),
      });
    } catch (err) {
      throw new Error(`network RPC unreachable (${(err as Error).message})`);
    }
    const body = (await res.json().catch(() => null)) as { result?: string } | null;
    if (!body?.result) throw new Error(`network RPC returned no chain id (HTTP ${res.status})`);
    const chainId = Number(BigInt(body.result));
    const net = ethers.Network.from(chainId);
    const req = new ethers.FetchRequest(url);
    req.timeout = 15000;
    this.provider = new ethers.JsonRpcProvider(req, net, { staticNetwork: net });
    this.network = { chainId, name: process.env.ETHEREUM_NETWORK_NAME || KNOWN_NETWORKS[chainId] || `chain ${chainId}` };
    this.logger.log(`connected to ${this.network.name} (chain id ${chainId})`);
    return this.provider;
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    await this.connect();
    return this.network!;
  }

  async getChainId(): Promise<number> {
    return (await this.getNetworkInfo()).chainId;
  }

  async getBalance(address: string): Promise<bigint> {
    return (await this.connect()).getBalance(address, 'latest');
  }

  async getBlockNumber(): Promise<number> {
    return (await this.connect()).getBlockNumber();
  }

  /** Broadcasts a raw signed transaction and returns its hash. */
  async broadcastTransaction(signedTx: string): Promise<string> {
    const provider = await this.connect();
    const txResponse = await provider.broadcastTransaction(signedTx);
    return txResponse.hash;
  }

  async getTransactionReceipt(txHash: string) {
    return (await this.connect()).getTransactionReceipt(txHash);
  }

  async getTransaction(txHash: string) {
    return (await this.connect()).getTransaction(txHash);
  }

  async getFeeData() {
    return (await this.connect()).getFeeData();
  }

  /** Nonce for an address: 'pending' counts transactions waiting in the node's mempool, 'latest' only mined ones. */
  async getNonce(address: string, tag: 'pending' | 'latest' = 'pending'): Promise<number> {
    return (await this.connect()).getTransactionCount(address, tag);
  }

  async estimateGas(tx: { from?: string; to: string; data?: string; value?: string }): Promise<bigint> {
    const provider = await this.connect();
    return provider.estimateGas({
      from: tx.from,
      to: tx.to,
      data: tx.data && tx.data !== '' ? tx.data : '0x',
      value: tx.value ? BigInt(tx.value) : 0n,
    });
  }
}
