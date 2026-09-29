import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { CustomersModule } from '../customers/customers.module';
import { SignModule } from '../sign/sign.module';
import { CustodyController } from './custody.controller';
import { CustodyService } from './custody.service';

@Module({
  imports: [HttpModule.register({ timeout: 5000 }), CustomersModule, SignModule],
  controllers: [CustodyController],
  providers: [CustodyService],
})
export class CustodyModule {}
