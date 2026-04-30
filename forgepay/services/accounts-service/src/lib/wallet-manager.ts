import { ethers } from 'ethers';
import { encryptPrivateKey, decryptPrivateKey } from './keystore.js';
import { config } from '../config.js';

export interface WalletInfo {
  address:      string;
  chain:        string;
  encryptedKey: string;
}

const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon:  137,
  base:     8453,
  arbitrum: 42161,
};

export class WalletManager {
  async generateWallet(chain: string = config.accounts.defaultChain): Promise<WalletInfo> {
    const wallet = ethers.Wallet.createRandom();
    return {
      address:      wallet.address,
      chain,
      encryptedKey: encryptPrivateKey(wallet.privateKey),
    };
  }

  async getPrivateKey(encryptedKey: string): Promise<string> {
    return decryptPrivateKey(encryptedKey);
  }

  async getSigner(encryptedKey: string, chain: string): Promise<ethers.Wallet> {
    const privateKey = decryptPrivateKey(encryptedKey);
    const provider   = this.getProvider(chain);
    return new ethers.Wallet(privateKey, provider);
  }

  getProvider(chain: string): ethers.JsonRpcProvider {
    const rpcUrls: Record<string, string> = {
      ethereum: config.rpc.ethereum,
      polygon:  config.rpc.polygon,
      base:     config.rpc.base,
      arbitrum: config.rpc.arbitrum,
    };
    const url = rpcUrls[chain];
    if (!url) throw new Error(`Unsupported chain: ${chain}`);
    const chainId = CHAIN_IDS[chain];
    return new ethers.JsonRpcProvider(url, chainId ? { chainId, name: chain } : undefined);
  }
}
