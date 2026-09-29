import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecoveryContact } from './entities/recovery-contact.entity';
import { RecoveryGuardian } from './entities/recovery-guardian.entity';
import { logger } from '../../common/logger';
import * as crypto from 'crypto';

@Injectable()
export class SocialRecoveryService {
  /**
   * M-of-N threshold: how many guardians must approve before recovery can
   * complete. Kept as an explicit policy constant so the check is enforced in
   * one place rather than being implicit ("any approval is enough").
   */
  private readonly requiredApprovals = 2;

  constructor(
    @InjectRepository(RecoveryContact)
    private recoveryContactRepository: Repository<RecoveryContact>,
    @InjectRepository(RecoveryGuardian)
    private recoveryGuardianRepository: Repository<RecoveryGuardian>,
  ) {}

  async addRecoveryContact(
    userId: string,
    contactEmail: string,
    contactName: string,
  ): Promise<RecoveryContact> {
    const existing = await this.recoveryContactRepository.findOne({
      where: { userId, contactEmail },
    });

    if (existing) {
      throw new BadRequestException('Contact already added');
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    const contact = this.recoveryContactRepository.create({
      userId,
      contactEmail,
      contactName,
      verificationToken,
      verificationTokenExpiresAt,
      isVerified: false,
    });

    const saved = await this.recoveryContactRepository.save(contact);

    // In production, dispatch a verification email here. The token is a secret
    // and must never be written to application logs.
    logger.info(`Recovery contact added for user ${userId}; verification email queued`);

    return saved;
  }

  async verifyRecoveryContact(userId: string, token: string): Promise<RecoveryContact> {
    const contact = await this.recoveryContactRepository.findOne({
      where: { userId, verificationToken: token },
    });

    if (!contact) {
      throw new NotFoundException('Invalid verification token');
    }

    if (
      !contact.verificationTokenExpiresAt ||
      contact.verificationTokenExpiresAt < new Date()
    ) {
      throw new BadRequestException('Verification token expired');
    }

    contact.isVerified = true;
    contact.verificationToken = null;
    contact.verificationTokenExpiresAt = null;

    return this.recoveryContactRepository.save(contact);
  }

  async getRecoveryContacts(userId: string): Promise<RecoveryContact[]> {
    return this.recoveryContactRepository.find({ where: { userId } });
  }

  async removeRecoveryContact(userId: string, contactId: string): Promise<void> {
    const contact = await this.recoveryContactRepository.findOne({
      where: { id: contactId, userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    await this.recoveryGuardianRepository.delete({ contactId });
    await this.recoveryContactRepository.remove(contact);
  }

  async initiateRecovery(userId: string, contactIds: string[]): Promise<void> {
    if (!Array.isArray(contactIds) || contactIds.length === 0) {
      throw new BadRequestException('At least one guardian must be selected');
    }

    // Only this user's verified contacts may act as guardians.
    const verifiedContacts = await this.recoveryContactRepository.find({
      where: { userId, isVerified: true },
    });
    const verifiedIds = new Set(verifiedContacts.map((c) => c.id));

    const invalidContactIds = contactIds.filter((id) => !verifiedIds.has(id));
    if (invalidContactIds.length > 0) {
      throw new BadRequestException(
        'Some selected contacts are not verified guardians for this user',
      );
    }

    if (contactIds.length < this.requiredApprovals) {
      throw new BadRequestException(
        `Recovery requires at least ${this.requiredApprovals} guardians; ` +
          `only ${contactIds.length} selected`,
      );
    }

    for (const contactId of contactIds) {
      const existingGuardian = await this.recoveryGuardianRepository.findOne({
        where: { userId, contactId },
      });

      if (!existingGuardian) {
        const guardian = this.recoveryGuardianRepository.create({
          userId,
          contactId,
          hasApproved: false,
          recoveryCode: crypto.randomBytes(16).toString('hex'),
        });

        await this.recoveryGuardianRepository.save(guardian);

        // In production, email the guardian their recovery request. The code is
        // a secret and must never be written to application logs.
        logger.info(
          `Recovery request queued for guardian ${contactId} (user ${userId})`,
        );
      }
    }
  }

  async approveRecovery(userId: string, recoveryCode: string): Promise<RecoveryGuardian> {
    const guardian = await this.recoveryGuardianRepository.findOne({
      where: { userId, recoveryCode },
    });

    if (!guardian) {
      throw new NotFoundException('Invalid recovery code');
    }

    if (guardian.hasApproved) {
      throw new BadRequestException('This guardian has already approved');
    }

    guardian.hasApproved = true;
    guardian.approvalTimestamp = new Date();
    // One-time code: invalidate after use so it cannot be replayed.
    guardian.recoveryCode = null;

    return this.recoveryGuardianRepository.save(guardian);
  }

  /**
   * Complete recovery once the M-of-N threshold is met.
   *
   * This is the point where access is actually restored. For a custodial
   * embedded wallet that means re-binding the wallet to the user's new
   * credential; for an ERC-4337 smart-account wallet it means submitting a
   * SimpleAccount.updateOwner UserOp to rotate the on-chain owner. That on-chain
   * step is the integration boundary and must be wired to the (testnet-verified)
   * account-abstraction path before this is relied on in production.
   */
  async completeRecovery(userId: string): Promise<{
    completed: boolean;
    approvedGuardians: number;
    requiredApprovals: number;
  }> {
    const status = await this.getRecoveryStatus(userId);

    if (status.approvedGuardians < this.requiredApprovals) {
      throw new BadRequestException(
        `Recovery needs ${this.requiredApprovals} approvals; ` +
          `have ${status.approvedGuardians}`,
      );
    }

    logger.info(
      `Recovery threshold met for user ${userId} ` +
        `(${status.approvedGuardians}/${this.requiredApprovals})`,
    );

    return {
      completed: true,
      approvedGuardians: status.approvedGuardians,
      requiredApprovals: this.requiredApprovals,
    };
  }

  /** Guardians that have NOT yet approved a pending recovery. */
  async getPendingApprovals(userId: string): Promise<RecoveryGuardian[]> {
    return this.recoveryGuardianRepository.find({
      where: { userId, hasApproved: false },
    });
  }

  async getRecoveryStatus(userId: string): Promise<{
    totalGuardians: number;
    approvedGuardians: number;
    requiredApprovals: number;
    recoveryInitiated: boolean;
    canComplete: boolean;
  }> {
    const guardians = await this.recoveryGuardianRepository.find({
      where: { userId },
    });

    const approvedCount = guardians.filter((g) => g.hasApproved).length;

    return {
      totalGuardians: guardians.length,
      approvedGuardians: approvedCount,
      requiredApprovals: this.requiredApprovals,
      recoveryInitiated: guardians.length > 0,
      canComplete: approvedCount >= this.requiredApprovals,
    };
  }
}
