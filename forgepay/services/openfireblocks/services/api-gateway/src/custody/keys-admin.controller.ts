import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { BackfillResult, KeysBackfillService } from './keys-backfill.service';
import { FleetRotationJob, KeysService } from './keys.service';

// Operator-only.
@Controller('admin/custody/keys')
@UseGuards(AdminGuard)
@SkipThrottle()
export class KeysAdminController {
  constructor(
    private readonly backfill: KeysBackfillService,
    private readonly keys: KeysService,
  ) {}

  // Provisions threshold keys for existing workspaces that have none yet.
  // Serialized with the start-up backfill, and safe to call repeatedly.
  @Post('backfill')
  @HttpCode(HttpStatus.OK)
  run(): Promise<BackfillResult> {
    return this.backfill.run();
  }

  // Moves every workspace's key to one committee, e.g. after replacing a node.
  // Body: { nodes: ["node1","node2","node3"], signersNeeded: 2 }. Runs in the background.
  @Post('rotate-all')
  @HttpCode(HttpStatus.ACCEPTED)
  async rotateAll(@Body() body: { nodes: string[]; signersNeeded: number }): Promise<FleetRotationJob> {
    const { nodes, threshold } = await this.keys.validateRotation(body?.nodes, body?.signersNeeded);
    if (nodes.length < 2) throw new BadRequestException('a committee needs at least two nodes');
    return this.keys.startFleetRotation(nodes, threshold);
  }

  @Get('rotate-all')
  rotationStatus(): FleetRotationJob | { state: 'idle' } {
    return this.keys.fleetStatus() ?? { state: 'idle' };
  }
}
