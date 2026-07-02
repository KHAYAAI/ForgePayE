import { Controller, Post, Get, Body, UseGuards, Req, Param } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserOpService } from './userop.service';
import { PaymasterService } from './paymaster.service';

@Controller('account-abstraction')
@UseGuards(JwtAuthGuard)
export class AccountAbstractionController {
  constructor(
    private userOpService: UserOpService,
    private paymasterService: PaymasterService,
  ) {}

  @Post('build-userop')
  async buildUserOp(
    @Req() req,
    @Body() body: { targetAddress: string; callData: string; gasLimit?: string },
  ) {
    const userOp = await this.userOpService.buildUserOp(
      req.user.userId,
      body.targetAddress,
      body.callData,
      body.gasLimit,
    );

    return {
      userOp,
      message: 'UserOp built. Sign with private key and send.',
    };
  }

  @Post('send-userop')
  async sendUserOp(
    @Req() req,
    @Body() body: { userOp: any; signature: string },
  ) {
    body.userOp.signature = body.signature;

    const result = await this.userOpService.sendUserOp(body.userOp, req.user.userId);

    return {
      ...result,
      message: 'UserOp submitted to bundler. Gas fees sponsored!',
      gasCost: '$0.00',
    };
  }

  @Get('userop-status/:userOpHash')
  async getUserOpStatus(@Param('userOpHash') userOpHash: string) {
    const receipt = await this.userOpService.getUserOpReceipt(userOpHash);

    return {
      userOpHash,
      status: receipt ? 'confirmed' : 'pending',
      receipt,
    };
  }

  @Get('paymaster/status')
  async getPaymasterStatus() {
    const status = await this.paymasterService.getPaymasterStatus();
    return status;
  }

  @Post('estimate-gas')
  async estimateGasCost(@Body() body: { userOp: any }) {
    const estimatedCost = await this.paymasterService.estimateGasCost(body.userOp);

    return {
      estimatedGasWei: estimatedCost,
      estimatedGasEth: (Number(estimatedCost) / 1e18).toFixed(6),
      sponsoredByOpenPrivy: true,
      userPays: '$0.00',
    };
  }

  @Get('paymaster/balance')
  async getPaymasterBalance() {
    const balance = await this.paymasterService.validatePaymasterBalance();
    return balance;
  }
}
