import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../modules/auth/entities/user.entity';
import { Wallet } from '../modules/wallet/entities/wallet.entity';
import { Transaction } from '../modules/transactions/entities/transaction.entity';
import { AuditLog } from '../common/entities/audit-log.entity';

export const typeOrmConfig: TypeOrmModuleOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [User, Wallet, Transaction, AuditLog],
  synchronize: process.env.NODE_ENV === 'development',
  logging: process.env.NODE_ENV === 'development',
  ssl:
    process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
  migrations: ['src/migrations/*.ts'],
  migrationsRun: true,
};
