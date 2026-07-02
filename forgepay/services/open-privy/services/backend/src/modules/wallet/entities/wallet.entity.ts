import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany } from 'typeorm';
import { User } from '../../auth/entities/user.entity';
import { Transaction } from '../../transactions/entities/transaction.entity';

@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @ManyToOne(() => User, (user) => user.wallets)
  user: User;

  @Column({ type: 'varchar', length: 255, unique: true })
  address: string;

  @Column({ type: 'varchar', length: 50 })
  chain: string; // 'ethereum', 'solana', 'polygon'

  @Column({ type: 'varchar', length: 1024, nullable: true })
  publicKey: string;

  @Column({ type: 'text', nullable: true })
  encryptedPrivateKey: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  recoveryEmail: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Transaction, (tx) => tx.wallet, { cascade: true })
  transactions: Transaction[];
}
