import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { join } from 'path';
import { User } from '../modules/auth/entities/user.entity';
import { Wallet } from '../modules/wallet/entities/wallet.entity';
import { Transaction } from '../modules/transactions/entities/transaction.entity';
import { AuditLog } from '../common/entities/audit-log.entity';
import { RecoveryContact } from '../modules/social-recovery/entities/recovery-contact.entity';
import { RecoveryGuardian } from '../modules/social-recovery/entities/recovery-guardian.entity';

const isProduction = process.env.NODE_ENV === 'production';

export const typeOrmConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [
    User,
    Wallet,
    Transaction,
    AuditLog,
    RecoveryContact,
    RecoveryGuardian,
  ],
  // Belt-and-suspenders: also pick up any entity registered via forFeature.
  autoLoadEntities: true,
  // NEVER synchronize outside local development — it can silently drop columns.
  // Staging/production get their schema from migrations (see the migrate job).
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.NODE_ENV === 'development',
  ssl:
    isProduction || process.env.DATABASE_SSL === 'true'
      ? { rejectUnauthorized: false }
      : false,
  migrations: [join(__dirname, '../migrations/*.{js,ts}')],
  // Migrations are applied by a dedicated job/initContainer, not by every
  // replica on boot (which would race).
  migrationsRun: false,
};
