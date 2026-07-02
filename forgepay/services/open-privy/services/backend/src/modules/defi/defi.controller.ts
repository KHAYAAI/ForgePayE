import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DefiService } from './services/defi.service';
import { SwapService } from './services/swap.service';
import { StakingService } from './services/staking.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('defi')
@UseGuards(JwtAuthGuard)
export class DefiController {
  constructor(
    private defiService: DefiService,
    private swapService: SwapService,
    private stakingService: StakingService,
  ) {}

  // Swap endpoints
  @Get('swap/quote')
  async getSwapQuote(
    @Query('chain') chain: string,
    @Query('fromToken') fromToken: string,
    @Query('toToken') toToken: string,
    @Query('amount') amount: string,
  ) {
    const chainId = this.swapService.getChainId(chain);
    const quote = await this.swapService.getSwapQuote(
      chainId,
      fromToken,
      toToken,
      amount,
    );
    return quote;
  }

  @Post('swap/build')
  async buildSwap(
    @CurrentUser() user: any,
    @Body()
    body: {
      chain: string;
      fromToken: string;
      toToken: string;
      amount: string;
      slippage?: number;
    },
  ) {
    const chainId = this.swapService.getChainId(body.chain);
    const swapTx = await this.swapService.buildSwapTx(
      chainId,
      body.fromToken,
      body.toToken,
      body.amount,
      user.walletAddress,
      body.slippage || 1,
    );
    return swapTx;
  }

  @Post('swap/execute')
  async executeSwap(
    @CurrentUser() user: any,
    @Body()
    body: {
      fromToken: string;
      toToken: string;
      fromAmount: string;
      toAmount: string;
      txHash: string;
    },
  ) {
    await this.defiService.recordSwap(
      user.walletAddress,
      body.fromToken,
      body.toToken,
      body.fromAmount,
      body.toAmount,
      body.txHash,
    );
    return { success: true, message: 'Swap recorded' };
  }

  @Get('swap/tokens/:chain')
  async getSwapTokens(@Param('chain') chain: string) {
    const chainId = this.swapService.getChainId(chain);
    const tokens = await this.swapService.getTokens(chainId);
    return tokens;
  }

  // Staking endpoints
  @Get('stake/info')
  async getStakingInfo(@CurrentUser() user: any) {
    const stakingInfo = await this.stakingService.getStakingInfo(
      user.walletAddress,
    );
    return stakingInfo;
  }

  @Post('stake/build')
  async buildStakeTx(
    @CurrentUser() user: any,
    @Body()
    body: {
      amount: string;
    },
  ) {
    const stakeTx = await this.stakingService.buildStakeTx(
      user.walletAddress,
      body.amount,
    );
    return stakeTx;
  }

  @Post('stake/execute')
  async executeStake(
    @CurrentUser() user: any,
    @Body()
    body: {
      amount: string;
      txHash: string;
    },
  ) {
    await this.defiService.recordStaking(
      user.walletAddress,
      body.amount,
      body.txHash,
    );
    return { success: true, message: 'Stake recorded' };
  }

  @Post('unstake/build')
  async buildUnstakeTx(
    @CurrentUser() user: any,
    @Body()
    body: {
      stethAmount: string;
    },
  ) {
    const unstakeTx = await this.stakingService.buildUnstakeTx(
      user.walletAddress,
      body.stethAmount,
    );
    return unstakeTx;
  }

  @Post('unstake/execute')
  async executeUnstake(
    @CurrentUser() user: any,
    @Body()
    body: {
      amount: string;
      txHash: string;
    },
  ) {
    await this.defiService.recordUnstaking(
      user.walletAddress,
      body.amount,
      body.txHash,
    );
    return { success: true, message: 'Unstake recorded' };
  }

  @Get('stats')
  async getDefiStats(@CurrentUser() user: any) {
    const stats = await this.defiService.getDefiStats(user.walletAddress);
    return stats;
  }
}
