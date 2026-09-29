import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Wallet } from './entities/wallet.entity';
import { EthereumService } from '../blockchain/ethereum.service';
import { SolanaService } from '../blockchain/solana.service';
import { PolygonService } from '../blockchain/polygon.service';
import { EncryptionService } from '../../common/encryption/encryption.service';
import { logger } from '../../common/logger';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private ethereumService: EthereumService,
    private solanaService: SolanaService,
    private polygonService: PolygonService,
    private encryptionService: EncryptionService,
  ) {}

  async createWallet(userId: string, chain: string): Promise<Wallet> {
    try {
      // Check if wallet already exists for this chain
      const existing = await this.walletRepository.findOne({
        where: { userId, chain },
      });

      if (existing) {
        throw new BadRequestException(
          `Wallet already exists for chain ${chain}`,
        );
      }

      let address: string;
      let publicKey: string;
      let privateKey: string;

      // Create wallet based on chain
      switch (chain.toLowerCase()) {
        case 'ethereum':
        case 'polygon':
          const ethersWallet = ethers.Wallet.createRandom();
          address = ethersWallet.address;
          publicKey = ethersWallet.publicKey;
          privateKey = ethersWallet.privateKey;
          break;

        case 'solana':
          const solanaWallet = await this.solanaService.createWallet();
          // Solana's public key doubles as the account address; the secret key
          // is the private key material to be encrypted.
          address = solanaWallet.publicKey;
          publicKey = solanaWallet.publicKey;
          privateKey = solanaWallet.secretKey;
          break;

        default:
          throw new BadRequestException(`Unsupported chain: ${chain}`);
      }

      // Encrypt private key with per-user key
      // Uses AES-256-GCM with per-user key derived from master key
      const encryptedPrivateKey = await this.encryptionService.encrypt(
        privateKey,
        userId,
      );

      // Create wallet record
      const wallet = this.walletRepository.create({
        userId,
        address,
        chain,
        publicKey,
        encryptedPrivateKey,
        recoveryEmail: null,
        isActive: true,
      });

      await this.walletRepository.save(wallet);

      logger.info(`Wallet created for user ${userId} on chain ${chain}`);

      return wallet;
    } catch (error) {
      logger.error(`Failed to create wallet: ${error.message}`);
      throw error;
    }
  }

  async getWallet(userId: string, chain?: string): Promise<Wallet | null> {
    const query = this.walletRepository.createQueryBuilder('wallet').where('wallet.userId = :userId', { userId });

    if (chain) {
      query.andWhere('wallet.chain = :chain', { chain });
    }

    return query.getOne();
  }

  async getWalletById(walletId: string): Promise<Wallet> {
    const wallet = await this.walletRepository.findOne({ where: { id: walletId } });
    if (!wallet) {
      throw new NotFoundException('Wallet not found');
    }
    return wallet;
  }

  async getUserWallets(userId: string): Promise<Wallet[]> {
    return this.walletRepository.find({ where: { userId, isActive: true } });
  }

  async getBalance(walletId: string): Promise<string> {
    const wallet = await this.getWalletById(walletId);

    try {
      let balance: string;

      switch (wallet.chain.toLowerCase()) {
        case 'ethereum':
          const ethBalance = await this.ethereumService.getBalance(wallet.address);
          balance = ethers.formatEther(ethBalance);
          break;

        case 'polygon':
          const polyBalance = await this.polygonService.getBalance(wallet.address);
          balance = ethers.formatEther(polyBalance);
          break;

        case 'solana':
          balance = (await this.solanaService.getBalance(wallet.address)).toString();
          break;

        default:
          throw new BadRequestException(`Unsupported chain: ${wallet.chain}`);
      }

      return balance;
    } catch (error) {
      logger.error(`Failed to get balance: ${error.message}`);
      throw error;
    }
  }

  async setRecoveryEmail(walletId: string, recoveryEmail: string): Promise<Wallet> {
    const wallet = await this.getWalletById(walletId);
    wallet.recoveryEmail = recoveryEmail;
    return this.walletRepository.save(wallet);
  }

  /**
   * Decrypt a wallet's private key for server-side (custodial) signing.
   *
   * SECURITY: This is the ONLY place a stored key is turned back into
   * plaintext. Callers MUST pass the authenticated userId; the key is only
   * released if the wallet belongs to that user, and the per-user encryption
   * key is derived from that same userId (so a mismatched user cannot decrypt).
   *
   * The plaintext key must never be logged, persisted, or returned to a client.
   */
  async getDecryptedPrivateKey(walletId: string, userId: string): Promise<string> {
    const wallet = await this.getWalletById(walletId);

    if (wallet.userId !== userId) {
      throw new ForbiddenException('Wallet does not belong to this user');
    }

    if (!wallet.encryptedPrivateKey) {
      throw new BadRequestException('Wallet has no key material to decrypt');
    }

    return this.encryptionService.decrypt(wallet.encryptedPrivateKey, userId);
  }

  /**
   * Build an ethers Wallet (signer) connected to the given provider for a
   * custodial EVM wallet. Used by the transaction service to sign and broadcast
   * on the user's behalf.
   */
  async getEvmSigner(
    walletId: string,
    userId: string,
    provider: ethers.Provider,
  ): Promise<ethers.Wallet> {
    const wallet = await this.getWalletById(walletId);

    if (wallet.userId !== userId) {
      throw new ForbiddenException('Wallet does not belong to this user');
    }

    const chain = wallet.chain.toLowerCase();
    if (chain !== 'ethereum' && chain !== 'polygon') {
      throw new BadRequestException(
        `getEvmSigner does not support chain: ${wallet.chain}`,
      );
    }

    const privateKey = await this.getDecryptedPrivateKey(walletId, userId);
    return new ethers.Wallet(privateKey, provider);
  }
}
