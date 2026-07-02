import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

interface SwapQuote {
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
  protocols: Array<{
    name: string;
    part: number;
  }>;
  gas: string;
  gasPrice: string;
}

interface SwapData {
  tx: {
    from: string;
    to: string;
    data: string;
    value: string;
    gas: string;
    gasPrice: string;
  };
  fromToken: string;
  toToken: string;
  fromAmount: string;
  toAmount: string;
}

@Injectable()
export class SwapService {
  private readonly oneInchApiUrl = 'https://api.1inch.io/v5.0';

  constructor(private httpService: HttpService) {}

  async getSwapQuote(
    chainId: number,
    fromToken: string,
    toToken: string,
    amount: string,
  ): Promise<SwapQuote> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.oneInchApiUrl}/${chainId}/quote`,
          {
            params: {
              fromTokenAddress: fromToken,
              toTokenAddress: toToken,
              amount: amount,
            },
          },
        ),
      );

      return response.data;
    } catch (error) {
      throw new Error(`Failed to get swap quote: ${error.message}`);
    }
  }

  async buildSwapTx(
    chainId: number,
    fromToken: string,
    toToken: string,
    amount: string,
    fromAddress: string,
    slippage: number = 1,
  ): Promise<SwapData> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.oneInchApiUrl}/${chainId}/swap`,
          {
            params: {
              fromTokenAddress: fromToken,
              toTokenAddress: toToken,
              amount: amount,
              fromAddress: fromAddress,
              slippage: slippage,
            },
          },
        ),
      );

      return response.data;
    } catch (error) {
      throw new Error(`Failed to build swap transaction: ${error.message}`);
    }
  }

  async getTokens(chainId: number): Promise<Record<string, any>> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(
          `${this.oneInchApiUrl}/${chainId}/tokens`,
        ),
      );

      return response.data.tokens;
    } catch (error) {
      throw new Error(`Failed to fetch tokens: ${error.message}`);
    }
  }

  async estimateSwapGas(
    chainId: number,
    fromToken: string,
    toToken: string,
    amount: string,
  ): Promise<string> {
    try {
      const quote = await this.getSwapQuote(
        chainId,
        fromToken,
        toToken,
        amount,
      );

      return quote.gas;
    } catch (error) {
      throw new Error(`Failed to estimate swap gas: ${error.message}`);
    }
  }

  getChainId(chain: string): number {
    const chainIds: Record<string, number> = {
      ethereum: 1,
      polygon: 137,
      avalanche: 43114,
      arbitrum: 42161,
      optimism: 10,
    };

    return chainIds[chain.toLowerCase()] || 1;
  }
}
