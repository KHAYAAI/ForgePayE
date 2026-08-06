import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Wallet } from './entities/wallet.entity';
import { EthereumService } from '../blockchain/ethereum.service';
import { SolanaService } from '../blockchain/solana.service';
import { PolygonService } from '../blockchain/polygon.service';
import { logger } from '../../common/logger';
import { encryptPrivateKey } from '../../common/crypto/private-key-crypto';

@Injectable()
export class WalletService {
  constructor(
    @InjectRepository(Wallet)
    private walletRepository: Repository<Wallet>,
    private ethereumService: EthereumService,
    private solanaService: SolanaService,
    private polygonService: PolygonService,
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
          address = solanaWallet.address;
          publicKey = solanaWallet.publicKey;
          privateKey = solanaWallet.privateKey;
          break;

        default:
          throw new BadRequestException(`Unsupported chain: ${chain}`);
      }

      // Authenticated encryption with a scrypt-derived per-wallet key.
      // Refuses to run in production without a real ENCRYPTION_KEY — see
      // common/crypto/private-key-crypto.ts for why the previous inline
      // AES-256-CBC block was unsafe.
      const encryptedPrivateKey = encryptPrivateKey(privateKey);

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
          balance = await this.solanaService.getBalance(wallet.address);
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
}
