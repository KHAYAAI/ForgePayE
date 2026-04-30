import { ethers } from 'ethers';
import { WalletManager } from './wallet-manager.js';

// Mainnet USDC contract addresses
const USDC_ADDRESSES: Record<string, string> = {
  ethereum: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  polygon:  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
  base:     '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  arbitrum: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
};

// Mainnet USDT contract addresses (Base does not have native USDT)
const USDT_ADDRESSES: Record<string, string> = {
  ethereum: '0xdAC17F958D2ee523a2206206994597C13D831ec7',
  polygon:  '0xc2132D05D31c914a87C6611C10748AEb04B58e8F',
  arbitrum: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9',
};

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
];

export interface TransferResult {
  txHash:       string;
  blockNumber?: number;
}

export class BlockchainManager {
  constructor(private readonly wallets: WalletManager) {}

  async getBalance(address: string, token: 'USDC' | 'USDT', chain: string): Promise<string> {
    const contractAddress = this.getContractAddress(token, chain);
    const provider        = this.wallets.getProvider(chain);
    const contract        = new ethers.Contract(contractAddress, ERC20_ABI, provider);
    const raw: bigint     = await contract.balanceOf(address) as bigint;
    // Both USDC and USDT use 6 decimals
    return ethers.formatUnits(raw, 6);
  }

  async transfer(
    fromEncryptedKey: string,
    toAddress: string,
    amountUnits: bigint,
    token: 'USDC' | 'USDT',
    chain: string,
  ): Promise<TransferResult> {
    const signer          = await this.wallets.getSigner(fromEncryptedKey, chain);
    const contractAddress = this.getContractAddress(token, chain);
    const contract        = new ethers.Contract(contractAddress, ERC20_ABI, signer);
    const tx: ethers.TransactionResponse = await contract.transfer(toAddress, amountUnits) as ethers.TransactionResponse;
    const receipt = await tx.wait(1);
    return {
      txHash:      tx.hash,
      blockNumber: receipt?.blockNumber ?? undefined,
    };
  }

  getContractAddress(token: 'USDC' | 'USDT', chain: string): string {
    const map = token === 'USDC' ? USDC_ADDRESSES : USDT_ADDRESSES;
    const addr = map[chain];
    if (!addr) throw new Error(`${token} not supported on chain: ${chain}`);
    return addr;
  }
}
