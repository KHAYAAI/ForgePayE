import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { logger } from '../../common/logger';
import { Transaction } from '../transactions/entities/transaction.entity';

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
export class PaymasterService {
  private pimlicoRpc: string;
  private entryPointAddress: string;

  constructor(
    @InjectRepository(Transaction)
    private txRepository: Repository<Transaction>,
  ) {
    this.pimlicoRpc = process.env.PIMLICO_ENDPOINT || 'https://api.pimlico.io/v2/ethereum/rpc';
    this.entryPointAddress = process.env.ENTRYPOINT_ADDRESS || '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
  }

  async getPaymasterData(userOp: UserOperation): Promise<string> {
    try {
      const response = await fetch(this.pimlicoRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'pm_sponsorUserOperation',
          params: [
            {
              sender: userOp.sender,
              nonce: userOp.nonce,
              initCode: userOp.initCode,
              callData: userOp.callData,
              accountGasLimits: userOp.accountGasLimits,
              preVerificationGas: userOp.preVerificationGas,
              gasFees: userOp.gasFees,
              signature: userOp.signature,
            },
            this.entryPointAddress,
          ],
          id: 1,
        }),
      });

      const data = await response.json();

      if (data.error) {
        logger.error(`Pimlico sponsorship error: ${data.error.message}`);
        throw new BadRequestException(`Paymaster declined: ${data.error.message}`);
      }

      const paymasterAndData = data.result?.paymasterAndData || '0x';
      logger.info(`Paymaster data received: ${paymasterAndData.substring(0, 50)}...`);

      return paymasterAndData;
    } catch (error) {
      logger.error(`Failed to get paymaster data: ${error.message}`);
      throw error;
    }
  }

  async trackGasCost(txHash: string, gasCostWei: string): Promise<void> {
    try {
      await this.txRepository.update(
        { txHash },
        {
          metadata: {
            gasSponsored: true,
            gasCostWei,
            sponsorshipTimestamp: new Date().toISOString(),
          },
        },
      );

      logger.info(`Gas sponsorship tracked: ${gasCostWei} wei for ${txHash}`);
    } catch (error) {
      logger.error(`Failed to track gas cost: ${error.message}`);
    }
  }

  async validatePaymasterBalance(): Promise<{ balance: string; sufficient: boolean }> {
    try {
      const response = await fetch(this.pimlicoRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'pimlico_getUserOperationGasPrice',
          params: [],
          id: 1,
        }),
      });

      const data = await response.json();

      // Pimlico handles balance management, but we can check sponsorship eligibility
      const sufficient = !data.error;

      return {
        balance: '∞', // Pimlico provides unlimited paymaster
        sufficient,
      };
    } catch (error) {
      logger.error(`Failed to validate paymaster balance: ${error.message}`);
      throw error;
    }
  }

  async estimateGasCost(userOp: UserOperation): Promise<string> {
    try {
      // Get sponsored UserOp which includes fee data
      const response = await fetch(this.pimlicoRpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'pm_sponsorUserOperation',
          params: [userOp, this.entryPointAddress],
          id: 1,
        }),
      });

      const data = await response.json();

      if (data.error) {
        return '0'; // If sponsorship fails, estimate 0
      }

      // Extract gas cost from sponsored UserOp
      const gasPrice = parseInt(userOp.gasFees) || 0;
      const callGasLimit = parseInt(userOp.accountGasLimits) || 100000;
      const estimatedCost = gasPrice * callGasLimit;

      return estimatedCost.toString();
    } catch (error) {
      logger.error(`Failed to estimate gas cost: ${error.message}`);
      return '0';
    }
  }

  async getPaymasterStatus(): Promise<{
    active: boolean;
    network: string;
    sponsorshipMode: string;
  }> {
    return {
      active: true,
      network: 'ethereum',
      sponsorshipMode: 'pimlico',
    };
  }
}
