import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';

import { AuthModule } from './modules/auth/auth.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { TransactionModule } from './modules/transactions/transaction.module';
import { AccountAbstractionModule } from './modules/account-abstraction/account-abstraction.module';
import { DefiModule } from './modules/defi/defi.module';
import { SocialRecoveryModule } from './modules/social-recovery/social-recovery.module';
import { MonitoringModule } from './modules/monitoring/monitoring.module';
import { HealthController } from './common/health.controller';
import { typeOrmConfig } from './config/typeorm.config';
import { jwtConfig } from './config/jwt.config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRoot(typeOrmConfig),
    JwtModule.register(jwtConfig),
    PassportModule,
    AuthModule,
    WalletModule,
    BlockchainModule,
    TransactionModule,
    AccountAbstractionModule,
    DefiModule,
    SocialRecoveryModule,
    MonitoringModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
