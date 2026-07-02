import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { Transaction } from '../blockchain/entities/transaction.entity';
import { DefiService } from './services/defi.service';
import { SwapService } from './services/swap.service';
import { StakingService } from './services/staking.service';
import { DefiController } from './defi.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction]),
    HttpModule,
  ],
  providers: [DefiService, SwapService, StakingService],
  controllers: [DefiController],
  exports: [DefiService, SwapService, StakingService],
})
export class DefiModule {}
