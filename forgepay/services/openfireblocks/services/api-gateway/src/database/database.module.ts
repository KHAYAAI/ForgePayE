import { Global, Module } from '@nestjs/common';
import { Pool } from 'pg';
import { PostgresService } from './postgres.service';
import { AuditService } from './audit.service';

// Provides a single shared PostgreSQL connection pool to the whole app, plus
// the transaction-metadata (PostgresService) and audit-trail (AuditService)
// repositories. Marked @Global so any module can inject these without re-importing.
import { PG_POOL } from './database.tokens';

export { PG_POOL };

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: () =>
        new Pool({
          connectionString:
            process.env.DATABASE_URL ??
            'postgresql://app:dev-only@localhost:5432/openfireblocks',
          // A transfer holds one connection for the per-address nonce lock while it uses others.
          max: Number(process.env.PG_POOL_MAX ?? 20),
        }),
    },
    PostgresService,
    AuditService,
  ],
  exports: [PG_POOL, PostgresService, AuditService],
})
export class DatabaseModule {}
