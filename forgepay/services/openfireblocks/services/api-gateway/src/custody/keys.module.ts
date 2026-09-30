import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { KeysService } from './keys.service';

@Module({
  imports: [HttpModule.register({ timeout: 10000 })],
  providers: [KeysService],
  exports: [KeysService],
})
export class KeysModule {}
