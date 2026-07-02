import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { nullable: true })
  userId: string;

  @Column({ type: 'varchar', length: 50 })
  eventType: string; // 'LOGIN', 'WALLET_CREATED', 'TRANSACTION_SIGNED', etc.

  @CreateDateColumn()
  timestamp: Date;

  @Column({ type: 'uuid', nullable: true })
  requestId: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'varchar', length: 45, nullable: true })
  ipAddress: string;
}
