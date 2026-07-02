import { Controller, Get, Post, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SocialRecoveryService } from './social-recovery.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('recovery')
@UseGuards(JwtAuthGuard)
export class SocialRecoveryController {
  constructor(private recoveryService: SocialRecoveryService) {}

  @Post('contacts')
  async addRecoveryContact(
    @CurrentUser() user: any,
    @Body() body: { contactEmail: string; contactName: string },
  ) {
    const contact = await this.recoveryService.addRecoveryContact(
      user.id,
      body.contactEmail,
      body.contactName,
    );
    return { success: true, contact };
  }

  @Get('contacts')
  async getRecoveryContacts(@CurrentUser() user: any) {
    const contacts = await this.recoveryService.getRecoveryContacts(user.id);
    return contacts;
  }

  @Post('contacts/verify')
  async verifyRecoveryContact(
    @CurrentUser() user: any,
    @Query('token') token: string,
  ) {
    const contact = await this.recoveryService.verifyRecoveryContact(
      user.id,
      token,
    );
    return { success: true, contact };
  }

  @Delete('contacts/:contactId')
  async removeRecoveryContact(
    @CurrentUser() user: any,
    @Param('contactId') contactId: string,
  ) {
    await this.recoveryService.removeRecoveryContact(user.id, contactId);
    return { success: true };
  }

  @Post('initiate')
  async initiateRecovery(
    @CurrentUser() user: any,
    @Body() body: { contactIds: string[] },
  ) {
    await this.recoveryService.initiateRecovery(user.id, body.contactIds);
    return { success: true, message: 'Recovery initiated' };
  }

  @Post('approve')
  async approveRecovery(
    @CurrentUser() user: any,
    @Query('code') recoveryCode: string,
  ) {
    const guardian = await this.recoveryService.approveRecovery(
      user.id,
      recoveryCode,
    );
    return { success: true, guardian };
  }

  @Get('status')
  async getRecoveryStatus(@CurrentUser() user: any) {
    const status = await this.recoveryService.getRecoveryStatus(user.id);
    return status;
  }

  @Get('approvals')
  async getPendingApprovals(@CurrentUser() user: any) {
    const approvals = await this.recoveryService.getRecoveryApprovals(user.id);
    return approvals;
  }
}
