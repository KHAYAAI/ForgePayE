import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RecoveryContact } from './entities/recovery-contact.entity';
import { RecoveryGuardian } from './entities/recovery-guardian.entity';
import * as crypto from 'crypto';

@Injectable()
export class SocialRecoveryService {
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
    // Check if contact already exists
    const existing = await this.recoveryContactRepository.findOne({
      where: { userId, contactEmail },
    });

    if (existing) {
      throw new BadRequestException('Contact already added');
    }

    // Generate verification token
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

    // In production, send verification email to contactEmail
    console.log(`Send verification email to ${contactEmail} with token: ${verificationToken}`);

    return saved;
  }

  async verifyRecoveryContact(userId: string, token: string): Promise<RecoveryContact> {
    const contact = await this.recoveryContactRepository.findOne({
      where: { userId, verificationToken: token },
    });

    if (!contact) {
      throw new NotFoundException('Invalid verification token');
    }

    if (contact.verificationTokenExpiresAt < new Date()) {
      throw new BadRequestException('Verification token expired');
    }

    contact.isVerified = true;
    contact.verificationToken = null;
    contact.verificationTokenExpiresAt = null;

    return this.recoveryContactRepository.save(contact);
  }

  async getRecoveryContacts(userId: string): Promise<RecoveryContact[]> {
    return this.recoveryContactRepository.find({
      where: { userId },
    });
  }

  async removeRecoveryContact(userId: string, contactId: string): Promise<void> {
    const contact = await this.recoveryContactRepository.findOne({
      where: { id: contactId, userId },
    });

    if (!contact) {
      throw new NotFoundException('Contact not found');
    }

    // Remove associated guardians
    await this.recoveryGuardianRepository.delete({ contactId });

    // Remove contact
    await this.recoveryContactRepository.remove(contact);
  }

  async initiateRecovery(userId: string, contactIds: string[]): Promise<void> {
    // Verify all contacts exist and are verified
    const contacts = await this.recoveryContactRepository.find({
      where: { userId, isVerified: true },
    });

    const validContactIds = contacts.map((c) => c.id);
    const invalidContactIds = contactIds.filter((id) => !validContactIds.includes(id));

    if (invalidContactIds.length > 0) {
      throw new BadRequestException('Some contacts are not verified');
    }

    // Create recovery guardians
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

        // In production, send recovery request email to guardian
        const contact = contacts.find((c) => c.id === contactId);
        console.log(`Send recovery request to ${contact?.contactEmail} with code: ${guardian.recoveryCode}`);
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

    guardian.hasApproved = true;
    guardian.approvalTimestamp = new Date();

    return this.recoveryGuardianRepository.save(guardian);
  }

  async getRecoveryApprovals(userId: string): Promise<RecoveryGuardian[]> {
    return this.recoveryGuardianRepository.find({
      where: { userId, hasApproved: false },
    });
  }

  async getRecoveryStatus(userId: string): Promise<{
    totalGuardians: number;
    approvedGuardians: number;
    recoveryInitiated: boolean;
  }> {
    const guardians = await this.recoveryGuardianRepository.find({
      where: { userId },
    });

    const approvedCount = guardians.filter((g) => g.hasApproved).length;

    return {
      totalGuardians: guardians.length,
      approvedGuardians: approvedCount,
      recoveryInitiated: guardians.length > 0,
    };
  }
}
