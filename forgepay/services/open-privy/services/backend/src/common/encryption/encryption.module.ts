import { Global, Module } from '@nestjs/common';
import { EncryptionService, MASTER_KEY_MATERIAL } from './encryption.service';
import { loadMasterKey } from './master-key.loader';

/**
 * Global module exposing the EncryptionService everywhere it is injected
 * (wallet key custody, key rotation, etc.).
 *
 * The master key is resolved asynchronously at boot via an async provider —
 * from AWS Secrets Manager in production (ENCRYPTION_MASTER_KEY_SECRET_ARN) or
 * from the env var locally — and injected into EncryptionService. If the key
 * cannot be resolved the app fails to start (fail-closed).
 */
@Global()
@Module({
  providers: [
    {
      provide: MASTER_KEY_MATERIAL,
      useFactory: loadMasterKey,
    },
    EncryptionService,
  ],
  exports: [EncryptionService],
})
export class EncryptionModule {}
