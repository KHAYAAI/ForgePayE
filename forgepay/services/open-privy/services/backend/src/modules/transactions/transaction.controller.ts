import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Req,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TransactionService } from './transaction.service';

@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionController {
  constructor(private txService: TransactionService) {}

  /**
   * Custodial send — the server signs with the user's stored key and
   * broadcasts. This is the primary "send funds" endpoint for embedded wallets.
   */
  @Post('send')
  async send(
    @Req() req: any,
    @Body() body: { walletId: string; to: string; amount: string },
  ) {
    const userId = req.user.userId;
    return this.txService.sendTransaction(
      userId,
      body.walletId,
      body.to,
      body.amount,
    );
  }

  @Post('request')
  async createSigningRequest(
    @Req() req: any,
    @Body()
    body: {
      walletId: string;
      to: string;
      amount: string;
      gasLimit?: number;
    },
  ) {
    const userId = req.user.userId;
    const tx = await this.txService.createSigningRequest(
      userId,
      body.walletId,
      body.to,
      body.amount,
      body.gasLimit,
    );
    return {
      id: tx.id,
      requestId: tx.requestId,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      amount: tx.amount,
      status: tx.status,
      metadata: tx.metadata,
    };
  }

  @Post(':txId/confirm')
  async confirmTransaction(
    @Req() req: any,
    @Param('txId') txId: string,
    @Body() body: { signedTx: string },
  ) {
    const userId = req.user.userId;
    return this.txService.confirmTransaction(userId, txId, body.signedTx);
  }

  @Get('history')
  async getTransactionHistory(@Req() req: any, @Query('limit') limit?: string) {
    const userId = req.user.userId;
    const txLimit = limit ? parseInt(limit, 10) : 20;
    const transactions = await this.txService.getUserTransactions(userId, txLimit);
    return {
      count: transactions.length,
      transactions: transactions.map((tx) => ({
        id: tx.id,
        txHash: tx.txHash,
        fromAddress: tx.fromAddress,
        toAddress: tx.toAddress,
        amount: tx.amount,
        status: tx.status,
        createdAt: tx.createdAt,
        confirmedAt: tx.confirmedAt,
      })),
    };
  }

  @Get(':txId')
  async getTransaction(@Req() req: any, @Param('txId') txId: string) {
    const tx = await this.txService.getTxById(txId);
    if (tx.userId !== req.user.userId) {
      throw new ForbiddenException('Transaction does not belong to this user');
    }
    return {
      id: tx.id,
      txHash: tx.txHash,
      fromAddress: tx.fromAddress,
      toAddress: tx.toAddress,
      amount: tx.amount,
      status: tx.status,
      createdAt: tx.createdAt,
      confirmedAt: tx.confirmedAt,
    };
  }
}
