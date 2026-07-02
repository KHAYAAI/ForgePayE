import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SocialRecoveryService } from './social-recovery.service';
import { SocialRecoveryController } from './social-recovery.controller';
import { RecoveryContact } from './entities/recovery-contact.entity';
import { RecoveryGuardian } from './entities/recovery-guardian.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecoveryContact, RecoveryGuardian]),
  ],
  providers: [SocialRecoveryService],
  controllers: [SocialRecoveryController],
  exports: [SocialRecoveryService],
})
export class SocialRecoveryModule {}
