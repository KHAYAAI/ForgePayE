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
  private chainId: number;

  constructor(
    @InjectRepository(Transaction)
    private txRepository: Repository<Transaction>,
    private ethereumService: EthereumService,
    private paymasterService: PaymasterService,
  ) {
    this.bundlerRpc = process.env.PIMLICO_ENDPOINT || 'https://api.pimlico.io/v2/ethereum/rpc';
    this.entryPointAddress = process.env.ENTRYPOINT_ADDRESS || '0x0000000071727De22E5E9d8BAf0edAc6f37da032';
    // Sepolia by default; MUST match the chain the EntryPoint lives on or the
    // userOpHash (and therefore the signature) will not match on-chain.
    this.chainId = Number(process.env.CHAIN_ID) || 11155111;
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
      const verificationGasLimit = BigInt(150000);
      const callGasLimit = BigInt(Number(estimatedGas) + 50000);

      // Get current gas price
      const gasPrice = await this.ethereumService.getGasPrice();
      const maxFeePerGas = gasPrice * BigInt(2); // 2x current for safety
      const maxPriorityFeePerGas = gasPrice / BigInt(2); // 0.5x base

      // EntryPoint v0.7 packs two uint128 values into a single bytes32 slot.
      // accountGasLimits = verificationGasLimit (high 128) | callGasLimit (low 128)
      // gasFees          = maxPriorityFeePerGas (high 128) | maxFeePerGas (low 128)
      const accountGasLimits = ethers.solidityPacked(
        ['uint128', 'uint128'],
        [verificationGasLimit, callGasLimit],
      );
      const gasFees = ethers.solidityPacked(
        ['uint128', 'uint128'],
        [maxPriorityFeePerGas, maxFeePerGas],
      );

      // Build UserOp
      const userOp: UserOperation = {
        sender: senderAddress,
        nonce: nonce.toString(),
        initCode: '0x', // Already deployed
        callData,
        accountGasLimits,
        preVerificationGas: '25000',
        gasFees,
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

      const data: any = await response.json();

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

      const data: any = await response.json();

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

  /**
   * Get the current nonce for a SimpleAccount from on-chain state.
   *
   * CRITICAL: This MUST match SimpleAccount.sol's nonce field.
   * Nonce is an incrementing counter (0, 1, 2, ...) that increments
   * after each successful validateUserOp().
   *
   * Mismatch with on-chain nonce will cause SIG_VALIDATION_FAILED.
   */
  private async getNonce(address: string): Promise<number> {
    try {
      const provider = this.ethereumService.getProvider();

      // SimpleAccount contract ABI (minimal - just nonce() function)
      const abi = [
        {
          inputs: [],
          name: 'nonce',
          outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function',
        },
      ];

      const contract = new ethers.Contract(address, abi, provider);

      // Query the current nonce from blockchain
      const nonce = await contract.nonce();

      logger.info(`Retrieved nonce for ${address}: ${nonce}`);
      return Number(nonce);
    } catch (error) {
      logger.error(
        `Failed to get nonce for ${address}: ${error.message}. ` +
        `Account may not be deployed yet.`
      );
      throw error;
    }
  }

  /**
   * Compute the EntryPoint v0.7 userOpHash.
   *
   * Per the spec this binds EVERY field of the (packed) UserOperation plus the
   * EntryPoint address and chainId. The previous implementation hashed only
   * sender/nonce/initCode/callData, so any signature over it would be rejected
   * on-chain. Signing must use exactly this hash.
   *
   * NOTE: This is now spec-shaped, but the full account-abstraction path
   * (account/EntryPoint version alignment, on-chain nonce semantics) still
   * requires end-to-end verification against a deployed EntryPoint on a testnet
   * before it can be relied upon.
   */
  private calculateUserOpHash(userOp: UserOperation): string {
    const abi = ethers.AbiCoder.defaultAbiCoder();

    const hashedOp = ethers.keccak256(
      abi.encode(
        [
          'address', // sender
          'uint256', // nonce
          'bytes32', // keccak(initCode)
          'bytes32', // keccak(callData)
          'bytes32', // accountGasLimits
          'uint256', // preVerificationGas
          'bytes32', // gasFees
          'bytes32', // keccak(paymasterAndData)
        ],
        [
          userOp.sender,
          userOp.nonce,
          ethers.keccak256(userOp.initCode),
          ethers.keccak256(userOp.callData),
          userOp.accountGasLimits,
          userOp.preVerificationGas,
          userOp.gasFees,
          ethers.keccak256(userOp.paymasterAndData),
        ],
      ),
    );

    return ethers.keccak256(
      abi.encode(
        ['bytes32', 'address', 'uint256'],
        [hashedOp, this.entryPointAddress, this.chainId],
      ),
    );
  }
}
