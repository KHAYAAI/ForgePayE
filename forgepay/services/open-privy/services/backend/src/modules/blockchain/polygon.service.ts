import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { logger } from '../../common/logger';

@Injectable()
export class PolygonService {
  private provider: ethers.JsonRpcProvider;
  private network: string;

  constructor() {
    const rpcUrl = process.env.ETHEREUM_RPC_POLYGON;
    if (!rpcUrl) {
      throw new Error('ETHEREUM_RPC_POLYGON not configured');
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.network = 'polygon';
    logger.info(`Polygon service initialized`);
  }

  async getBalance(address: string): Promise<bigint> {
    try {
      const balance = await this.provider.getBalance(address);
      return balance;
    } catch (error) {
      logger.error(`Failed to get Polygon balance: ${error.message}`);
      throw error;
    }
  }

  async getGasPrice(): Promise<bigint> {
    try {
      return await this.provider.getGasPrice();
    } catch (error) {
      logger.error(`Failed to get Polygon gas price: ${error.message}`);
      throw error;
    }
  }

  async estimateGas(to: string, data: string, value?: string): Promise<bigint> {
    try {
      return await this.provider.estimateGas({
        to,
        data,
        value: value ? ethers.parseEther(value) : undefined,
      });
    } catch (error) {
      logger.error(`Failed to estimate Polygon gas: ${error.message}`);
      throw error;
    }
  }

  async broadcastTransaction(signedTx: string): Promise<string> {
    try {
      const txResponse = await this.provider.broadcastTransaction(signedTx);
      logger.info(`Polygon transaction broadcast: ${txResponse.hash}`);
      return txResponse.hash;
    } catch (error) {
      logger.error(`Failed to broadcast Polygon transaction: ${error.message}`);
      throw error;
    }
  }

  async getTransactionReceipt(txHash: string): Promise<any> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (error) {
      logger.error(`Failed to get Polygon transaction receipt: ${error.message}`);
      throw error;
    }
  }

  async validateAddress(address: string): Promise<boolean> {
    return ethers.isAddress(address);
  }

  async getTokenBalance(tokenAddress: string, walletAddress: string): Promise<string> {
    try {
      const ERC20_ABI = [
        'function balanceOf(address owner) public view returns (uint256)',
        'function decimals() public view returns (uint8)',
      ];

      const contract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
      const balance = await contract.balanceOf(walletAddress);
      const decimals = await contract.decimals();

      return ethers.formatUnits(balance, decimals);
    } catch (error) {
      logger.error(`Failed to get Polygon token balance: ${error.message}`);
      throw error;
    }
  }
}
