import { Controller, Post, Get, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';

@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private walletService: WalletService) {}

  @Post('create')
  async createWallet(@Req() req, @Body() dto: CreateWalletDto) {
    const userId = req.user.userId;
    return this.walletService.createWallet(userId, dto.chain);
  }

  @Get('get')
  async getWallet(@Req() req, @Query('chain') chain?: string) {
    const userId = req.user.userId;
    const wallet = await this.walletService.getWallet(userId, chain);
    if (!wallet) {
      return { message: 'No wallet found' };
    }
    return {
      id: wallet.id,
      address: wallet.address,
      chain: wallet.chain,
      createdAt: wallet.createdAt,
    };
  }

  @Get('list')
  async getUserWallets(@Req() req) {
    const userId = req.user.userId;
    const wallets = await this.walletService.getUserWallets(userId);
    return wallets.map((w) => ({
      id: w.id,
      address: w.address,
      chain: w.chain,
      createdAt: w.createdAt,
    }));
  }

  @Get(':walletId/balance')
  async getBalance(@Param('walletId') walletId: string) {
    const balance = await this.walletService.getBalance(walletId);
    return { balance, unit: 'ETH' };
  }

  @Post(':walletId/recovery-email')
  async setRecoveryEmail(
    @Param('walletId') walletId: string,
    @Body() body: { recoveryEmail: string },
  ) {
    await this.walletService.setRecoveryEmail(walletId, body.recoveryEmail);
    return { message: 'Recovery email set successfully' };
  }
}
