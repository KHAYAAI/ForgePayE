import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Transaction } from '../transactions/entities/transaction.entity';
import { EthereumService } from '../blockchain/ethereum.service';
import { PaymasterService } from './paymaster.service';
import { logger } from '../../common/logger';

interface UserOperation {
  sender: string;
  nonce: string;
  initCode: string;
  callData: string;
  accountGasLimits: string;
  preVerificationGas: string;
  gasFees: string;
  paymasterAndData: string;
  signature: string;
}

@Injectable()
export class UserOpService {
  private bundlerRpc: string;
  private entryPointAddress: string;

  constructor(
    @InjectRepository(Transaction)
    private txRepository: Repository<Transaction>,
    private ethereumService: EthereumService,
    private paymasterService: PaymasterService,
  ) {
    this.bundlerRpc = process.env.PIMLICO_ENDPOINT || 'https://api.pimlico.io/v2/ethereum/rpc';
    this.entryPointAddress = process.env.ENTRYPOINT_ADDRESS || '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
  }

  async buildUserOp(
    senderAddress: string,
    targetAddress: string,
    callData: string,
    gasLimit?: string,
  ): Promise<UserOperation> {
    try {
      // Get current nonce
      const nonce = await this.getNonce(senderAddress);

      // Estimate gas
      const estimatedGas = gasLimit || (await this.ethereumService.estimateGas(targetAddress, callData));
      const verificationGasLimit = '150000';
      const callGasLimit = (Number(estimatedGas) + 50000).toString();

      // Get current gas price
      const gasPrice = await this.ethereumService.getGasPrice();
      const maxFeePerGas = (gasPrice * BigInt(2)).toString(); // 2x current for safety
      const maxPriorityFeePerGas = (gasPrice / BigInt(2)).toString(); // 0.5x base

      // Build UserOp
      const userOp: UserOperation = {
        sender: senderAddress,
        nonce: nonce.toString(),
        initCode: '0x', // Already deployed
        callData,
        accountGasLimits: ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256'],
          [verificationGasLimit, callGasLimit],
        ),
        preVerificationGas: '25000',
        gasFees: ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256'],
          [maxFeePerGas, maxPriorityFeePerGas],
        ),
        paymasterAndData: '0x',
        signature: '0x',
      };

      logger.info(`UserOp built for ${senderAddress}`);
      return userOp;
    } catch (error) {
      logger.error(`Failed to build UserOp: ${error.message}`);
      throw error;
    }
  }

  async signUserOp(userOp: UserOperation, privateKey: string): Promise<string> {
    try {
      // Calculate UserOpHash
      const userOpHash = this.calculateUserOpHash(userOp);

      // Sign the hash
      const wallet = new ethers.Wallet(privateKey);
      const signature = await wallet.signMessage(ethers.getBytes(userOpHash));

      userOp.signature = signature;
      return signature;
    } catch (error) {
      logger.error(`Failed to sign UserOp: ${error.message}`);
      throw error;
    }
  }

  async sendUserOp(
    userOp: UserOperation,
    userId: string,
  ): Promise<{ userOpHash: string; status: string }> {
    try {
      // Add paymaster data
      userOp.paymasterAndData = await this.paymasterService.getPaymasterData(userOp);

      // Send to bundler via Pimlico
      const response = await fetch(this.bundlerRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_sendUserOperation',
          params: [userOp, this.entryPointAddress],
          id: 1,
        }),
      });

      const data = await response.json();

      if (data.error) {
        throw new BadRequestException(`Bundler error: ${data.error.message}`);
      }

      const userOpHash = data.result;

      // Record in database
      const tx = this.txRepository.create({
        userId,
        chain: 'ethereum',
        fromAddress: userOp.sender,
        toAddress: 'unknown', // Will be extracted from callData
        amount: '0',
        status: 'pending',
        metadata: {
          userOpHash,
          isAccountAbstraction: true,
          bundler: 'pimlico',
        },
      });

      await this.txRepository.save(tx);

      logger.info(`UserOp sent: ${userOpHash}`);

      return {
        userOpHash,
        status: 'pending',
      };
    } catch (error) {
      logger.error(`Failed to send UserOp: ${error.message}`);
      throw error;
    }
  }

  async getUserOpReceipt(userOpHash: string): Promise<any> {
    try {
      const response = await fetch(this.bundlerRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getUserOperationReceipt',
          params: [userOpHash],
          id: 1,
        }),
      });

      const data = await response.json();

      if (data.error) {
        logger.error(`Failed to get UserOp receipt: ${data.error.message}`);
        return null;
      }

      return data.result;
    } catch (error) {
      logger.error(`Failed to get UserOp receipt: ${error.message}`);
      throw error;
    }
  }

  private async getNonce(address: string): Promise<number> {
    // In production, query EntryPoint contract for actual nonce
    // For MVP, use timestamp-based nonce
    return Math.floor(Date.now() / 1000);
  }

  private calculateUserOpHash(userOp: UserOperation): string {
    // Simplified UserOp hash calculation
    // In production, follow EIP-4337 specification exactly
    const packed = ethers.solidityPacked(
      ['address', 'uint256', 'bytes', 'bytes'],
      [userOp.sender, userOp.nonce, userOp.initCode, userOp.callData],
    );

    return ethers.keccak256(packed);
  }
}
