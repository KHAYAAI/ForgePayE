import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('recovery_guardians')
export class RecoveryGuardian {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('uuid')
  contactId: string;

  @Column({ default: false })
  hasApproved: boolean;

  @Column({ type: 'timestamp', nullable: true })
  approvalTimestamp: Date | null;

  @Column({ type: 'text', nullable: true })
  recoveryCode: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
