import { Injectable } from '@nestjs/common';
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { logger } from '../../common/logger';

@Injectable()
export class SolanaService {
  private connection: Connection;
  private network: string;

  constructor() {
    this.network = process.env.NODE_ENV === 'production' ? 'mainnet-beta' : 'devnet';
    const rpcUrl =
      this.network === 'mainnet-beta'
        ? process.env.SOLANA_RPC_MAINNET
        : process.env.SOLANA_RPC_DEVNET;

    this.connection = new Connection(rpcUrl || 'https://api.devnet.solana.com');
    logger.info(`Solana service initialized (${this.network})`);
  }

  async createWallet(): Promise<{ publicKey: string; secretKey: string }> {
    try {
      const keypair = Keypair.generate();

      return {
        publicKey: keypair.publicKey.toString(),
        secretKey: Buffer.from(keypair.secretKey).toString('hex'),
      };
    } catch (error) {
      logger.error(`Failed to create Solana wallet: ${error.message}`);
      throw error;
    }
  }

  async getBalance(publicKeyStr: string): Promise<number> {
    try {
      const publicKey = new PublicKey(publicKeyStr);
      const balance = await this.connection.getBalance(publicKey);
      return balance / LAMPORTS_PER_SOL; // Convert lamports to SOL
    } catch (error) {
      logger.error(`Failed to get Solana balance: ${error.message}`);
      throw error;
    }
  }

  async sendTransaction(
    secretKeyHex: string,
    toPublicKey: string,
    amount: number,
  ): Promise<string> {
    try {
      const keypair = Keypair.fromSecretKey(Buffer.from(secretKeyHex, 'hex'));
      const toKey = new PublicKey(toPublicKey);

      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: keypair.publicKey,
          toPubkey: toKey,
          lamports: amount * LAMPORTS_PER_SOL,
        }),
      );

      const signature = await sendAndConfirmTransaction(this.connection, tx, [keypair]);
      logger.info(`Solana transaction confirmed: ${signature}`);
      return signature;
    } catch (error) {
      logger.error(`Failed to send Solana transaction: ${error.message}`);
      throw error;
    }
  }

  async getTransactionStatus(signature: string): Promise<any> {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return status;
    } catch (error) {
      logger.error(`Failed to get transaction status: ${error.message}`);
      throw error;
    }
  }

  async estimateGas(
    _fromPublicKey: string,
    _toPublicKey: string,
    _amount: number,
  ): Promise<number> {
    // Solana has fixed fees, not gas-based
    try {
      const fees = await this.connection.getRecentBlockhash();
      return fees.feeCalculator.lamportsPerSignature;
    } catch (error) {
      logger.error(`Failed to estimate Solana fees: ${error.message}`);
      throw error;
    }
  }

  async validateAddress(address: string): Promise<boolean> {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}
