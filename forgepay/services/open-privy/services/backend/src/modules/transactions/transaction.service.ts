import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Transaction } from './entities/transaction.entity';
import { EthereumService } from '../blockchain/ethereum.service';
import { WalletService } from '../wallet/wallet.service';
import { logger } from '../../common/logger';
import * as crypto from 'crypto';

@Injectable()
export class TransactionService {
  constructor(
    @InjectRepository(Transaction)
    private txRepository: Repository<Transaction>,
    private ethereumService: EthereumService,
    private walletService: WalletService,
  ) {}

  async createSigningRequest(
    userId: string,
    walletId: string,
    to: string,
    amount: string,
    gasLimit?: number,
  ): Promise<Transaction> {
    try {
      const wallet = await this.walletService.getWalletById(walletId);

      if (wallet.userId !== userId) {
        throw new BadRequestException('Wallet does not belong to this user');
      }

      // Estimate gas if not provided
      if (!gasLimit) {
        const estimatedGas = await this.ethereumService.estimateGas(to, '0x');
        gasLimit = Number(estimatedGas) + 21000; // Buffer
      }

      // Create transaction record
      const tx = this.txRepository.create({
        userId,
        walletId,
        requestId: crypto.randomUUID(),
        chain: wallet.chain,
        fromAddress: wallet.address,
        toAddress: to,
        amount: ethers.parseEther(amount).toString(),
        status: 'pending',
        metadata: {
          gasLimit,
          gasEstimate: true,
        },
      });

      await this.txRepository.save(tx);

      logger.info(`Transaction signing request created: ${tx.requestId}`);

      return tx;
    } catch (error) {
      logger.error(`Failed to create signing request: ${error.message}`);
      throw error;
    }
  }

  async confirmTransaction(
    userId: string,
    txId: string,
    signedTx: string,
  ): Promise<any> {
    try {
      const tx = await this.getTxById(txId);

      if (tx.userId !== userId) {
        throw new BadRequestException('Transaction does not belong to this user');
      }

      // Broadcast to blockchain
      const txHash = await this.ethereumService.broadcastTransaction(signedTx);

      // Update transaction record
      tx.txHash = txHash;
      tx.status = 'pending';

      await this.txRepository.save(tx);

      logger.info(`Transaction confirmed and broadcast: ${txHash}`);

      return {
        id: tx.id,
        txHash,
        status: tx.status,
        message: 'Transaction broadcast successfully',
      };
    } catch (error) {
      logger.error(`Failed to confirm transaction: ${error.message}`);
      throw error;
    }
  }

  async getTxById(txId: string): Promise<Transaction> {
    const tx = await this.txRepository.findOne({ where: { id: txId } });
    if (!tx) {
      throw new NotFoundException('Transaction not found');
    }
    return tx;
  }

  async getUserTransactions(userId: string, limit: number = 20): Promise<Transaction[]> {
    return this.txRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  async updateTransactionStatus(txHash: string, status: string): Promise<void> {
    try {
      const receipt = await this.ethereumService.getTransactionReceipt(txHash);

      if (receipt) {
        const finalStatus = receipt.status === 1 ? 'confirmed' : 'failed';
        await this.txRepository.update(
          { txHash },
          {
            status: finalStatus,
            confirmedAt: new Date(),
            metadata: receipt,
          },
        );
      }
    } catch (error) {
      logger.error(`Failed to update transaction status: ${error.message}`);
    }
  }
}
