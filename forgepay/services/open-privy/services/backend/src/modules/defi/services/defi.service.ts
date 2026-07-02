import { Injectable } from '@nestjs/common';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { SwapService } from './swap.service';
import { StakingService } from './staking.service';
import { Transaction } from '../../blockchain/entities/transaction.entity';

interface DefiOperation {
  type: 'swap' | 'stake' | 'unstake';
  timestamp: Date;
  walletAddress: string;
  details: Record<string, any>;
}

@Injectable()
export class DefiService {
  constructor(
    @InjectRepository(Transaction)
    private transactionRepository: Repository<Transaction>,
    private swapService: SwapService,
    private stakingService: StakingService,
  ) {}

  async recordSwap(
    walletAddress: string,
    fromToken: string,
    toToken: string,
    fromAmount: string,
    toAmount: string,
    txHash: string,
  ): Promise<void> {
    const operation: DefiOperation = {
      type: 'swap',
      timestamp: new Date(),
      walletAddress,
      details: {
        fromToken,
        toToken,
        fromAmount,
        toAmount,
        txHash,
      },
    };

    // Log swap for analytics
    await this.logDefiOperation(operation);
  }

  async recordStaking(
    walletAddress: string,
    amount: string,
    txHash: string,
  ): Promise<void> {
    const operation: DefiOperation = {
      type: 'stake',
      timestamp: new Date(),
      walletAddress,
      details: {
        amount,
        txHash,
      },
    };

    await this.logDefiOperation(operation);
  }

  async recordUnstaking(
    walletAddress: string,
    amount: string,
    txHash: string,
  ): Promise<void> {
    const operation: DefiOperation = {
      type: 'unstake',
      timestamp: new Date(),
      walletAddress,
      details: {
        amount,
        txHash,
      },
    };

    await this.logDefiOperation(operation);
  }

  async getDefiStats(walletAddress: string): Promise<Record<string, any>> {
    // Get staking info
    const stakingInfo = await this.stakingService.getStakingInfo(walletAddress);

    return {
      staking: stakingInfo,
      timestamp: new Date(),
    };
  }

  private async logDefiOperation(operation: DefiOperation): Promise<void> {
    // In a real implementation, store this in a dedicated DefiOperation table
    console.log(`DeFi Operation: ${JSON.stringify(operation)}`);
  }
}
