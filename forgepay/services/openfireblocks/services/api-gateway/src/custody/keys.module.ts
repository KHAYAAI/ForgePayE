import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KeysService } from './keys.service';
import { KeysBackfillService } from './keys-backfill.service';
import { KeysAdminController } from './keys-admin.controller';

@Module({
  imports: [HttpModule.register({ timeout: 10000 })],
  controllers: [KeysAdminController],
  providers: [KeysService, KeysBackfillService],
  exports: [KeysService, KeysBackfillService],
})
export class KeysModule {}
