import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Wallet } from '../../wallet/entities/wallet.entity';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, (user) => user.transactions)
  user: User;

  @Column('uuid', { nullable: true })
  walletId?: string;

  @ManyToOne(() => Wallet, (wallet) => wallet.transactions, { nullable: true })
  wallet?: Wallet;

  @Column({ type: 'uuid', nullable: true })
  requestId: string;

  @Column({ type: 'varchar', length: 50 })
  chain: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  txHash: string;

  @Column({ type: 'varchar', length: 255 })
  fromAddress: string;

  @Column({ type: 'varchar', length: 255 })
  toAddress: string;

  @Column({ type: 'varchar', length: 100 })
  amount: string; // Wei or lamports as string

  @Column({ type: 'varchar', length: 100, nullable: true })
  feePaid: string;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  status: string; // 'pending', 'confirmed', 'failed'

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  confirmedAt: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;
}
