import { Module } from '@nestjs/common';
import { EthereumService } from './ethereum.service';
import { SolanaService } from './solana.service';
import { PolygonService } from './polygon.service';
import { BlockchainController } from './blockchain.controller';

@Module({
  providers: [EthereumService, SolanaService, PolygonService],
  controllers: [BlockchainController],
  exports: [EthereumService, SolanaService, PolygonService],
})
export class BlockchainModule {}
