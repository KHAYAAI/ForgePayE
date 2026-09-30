import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { BackfillResult, KeysBackfillService } from './keys-backfill.service';

// Operator-only. Provisions threshold keys for existing workspaces that have none yet.
// Serialized with the start-up backfill, and safe to call repeatedly.
@Controller('admin/custody/keys')
@UseGuards(AdminGuard)
@SkipThrottle()
export class KeysAdminController {
  constructor(private readonly backfill: KeysBackfillService) {}

  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  run(): Promise<BackfillResult> {
    return this.backfill.run();
  }
}
