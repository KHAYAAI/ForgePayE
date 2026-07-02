import { Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import axios from 'axios';
import { logger } from '../../common/logger';

@Injectable()
export class EthereumService {
  private provider: ethers.JsonRpcProvider;
  private alchemyApiKey: string;

  constructor() {
    const rpcUrl = process.env.ETHEREUM_RPC_SEPOLIA;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.alchemyApiKey = process.env.ALCHEMY_API_KEY;
  }

  async getBalance(address: string): Promise<bigint> {
    try {
      const balance = await this.provider.getBalance(address);
      return balance;
    } catch (error) {
      logger.error(`Failed to get balance for ${address}: ${error.message}`);
      throw error;
    }
  }

  async broadcastTransaction(signedTx: string): Promise<string> {
    try {
      const txResponse = await this.provider.broadcastTransaction(signedTx);
      logger.info(`Transaction broadcast: ${txResponse.hash}`);
      return txResponse.hash;
    } catch (error) {
      logger.error(`Failed to broadcast transaction: ${error.message}`);
      throw error;
    }
  }

  async getGasPrice(): Promise<bigint> {
    try {
      return await this.provider.getGasPrice();
    } catch (error) {
      logger.error(`Failed to get gas price: ${error.message}`);
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
      logger.error(`Failed to estimate gas: ${error.message}`);
      throw error;
    }
  }

  async getTransactionReceipt(txHash: string): Promise<any> {
    try {
      return await this.provider.getTransactionReceipt(txHash);
    } catch (error) {
      logger.error(`Failed to get transaction receipt: ${error.message}`);
      throw error;
    }
  }

  async getTransactionHistory(
    address: string,
    limit: number = 10,
  ): Promise<any[]> {
    try {
      // Use Alchemy API for transaction history
      const response = await axios.post(
        `${process.env.ALCHEMY_API_URL || 'https://eth-sepolia.g.alchemy.com/v2'}/${this.alchemyApiKey}`,
        {
          jsonrpc: '2.0',
          method: 'alchemy_getAssetTransfers',
          params: [
            {
              fromAddress: address,
              category: ['external', 'internal', 'erc20'],
              maxCount: `0x${limit.toString(16)}`,
            },
          ],
          id: 1,
        },
      );

      return response.data.result?.transfers || [];
    } catch (error) {
      logger.error(`Failed to get transaction history: ${error.message}`);
      return [];
    }
  }
}
