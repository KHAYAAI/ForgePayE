import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SignController } from './sign.controller';
import { SignService } from './sign.service';
import { EthereumService } from '../blockchain/ethereum.service';
import { PrepareService } from '../blockchain/prepare.service';
import { NonceService } from '../blockchain/nonce.service';
import { TransferPlanner } from '../blockchain/transfer-planner.service';
import { TxPollerService } from '../blockchain/tx-poller.service';
import { CustomersModule } from '../customers/customers.module';
import { PolicyModule } from '../policies/policy.module';
import { RiskModule } from '../risk/risk.module';
import { BillingModule } from '../billing/billing.module';
import { KeysModule } from '../custody/keys.module';

// Bundles the tenant-facing signing API with its MPC-signer HTTP client, the
// Ethereum broadcast service, tenant auth (CustomersModule) and policy checks.
// Database + metrics services come from the global modules.
@Module({
  imports: [
    HttpModule.register({ timeout: 10000 }),
    CustomersModule,
    PolicyModule,
    RiskModule,
    BillingModule,
    KeysModule,
  ],
  controllers: [SignController],
  providers: [SignService, EthereumService, PrepareService, NonceService, TransferPlanner, TxPollerService],
  exports: [SignService, EthereumService],
})
export class SignModule {}
