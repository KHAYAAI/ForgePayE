import { Controller, Get, Param, Query } from '@nestjs/common';
import { EthereumService } from './ethereum.service';
import { SolanaService } from './solana.service';
import { PolygonService } from './polygon.service';

@Controller('blockchain')
export class BlockchainController {
  constructor(
    private ethereumService: EthereumService,
    private solanaService: SolanaService,
    private polygonService: PolygonService,
  ) {}

  @Get('balance/:address')
  async getBalance(@Param('address') address: string) {
    const balance = await this.ethereumService.getBalance(address);
    return {
      address,
      balance: balance.toString(),
      balanceEth: Math.floor((Number(balance) / 1e18) * 1000000) / 1000000,
    };
  }

  @Get('gas-price')
  async getGasPrice() {
    const gasPrice = await this.ethereumService.getGasPrice();
    return {
      gasPrice: gasPrice.toString(),
      gasPriceGwei: Math.floor((Number(gasPrice) / 1e9) * 1000) / 1000,
    };
  }

  @Get('tx-history/:address')
  async getTransactionHistory(
    @Param('address') address: string,
    @Query('limit') limit?: string,
  ) {
    const txLimit = limit ? parseInt(limit, 10) : 10;
    const history = await this.ethereumService.getTransactionHistory(address, txLimit);
    return {
      address,
      count: history.length,
      transactions: history,
    };
  }

  @Get('tx-receipt/:txHash')
  async getTransactionReceipt(@Param('txHash') txHash: string) {
    const receipt = await this.ethereumService.getTransactionReceipt(txHash);
    return receipt;
  }

  // SOLANA ENDPOINTS
  @Get('solana/balance/:address')
  async getSolanaBalance(@Param('address') address: string) {
    const balance = await this.solanaService.getBalance(address);
    return {
      address,
      balance,
      balanceFormatted: `${balance.toFixed(4)} SOL`,
      chain: 'solana',
    };
  }

  @Get('solana/validate-address/:address')
  async validateSolanaAddress(@Param('address') address: string) {
    const isValid = await this.solanaService.validateAddress(address);
    return { address, valid: isValid, chain: 'solana' };
  }

  // POLYGON ENDPOINTS
  @Get('polygon/balance/:address')
  async getPolygonBalance(@Param('address') address: string) {
    const balance = await this.polygonService.getBalance(address);
    const formattedBalance = Math.floor((Number(balance) / 1e18) * 1000000) / 1000000;
    return {
      address,
      balance: balance.toString(),
      balanceFormatted: `${formattedBalance.toFixed(6)} MATIC`,
      chain: 'polygon',
    };
  }

  @Get('polygon/gas-price')
  async getPolygonGasPrice() {
    const gasPrice = await this.polygonService.getGasPrice();
    return {
      gasPrice: gasPrice.toString(),
      gasPriceGwei: Math.floor((Number(gasPrice) / 1e9) * 1000) / 1000,
      chain: 'polygon',
    };
  }

  @Get('polygon/token-balance/:tokenAddress/:walletAddress')
  async getPolygonTokenBalance(
    @Param('tokenAddress') tokenAddress: string,
    @Param('walletAddress') walletAddress: string,
  ) {
    const balance = await this.polygonService.getTokenBalance(tokenAddress, walletAddress);
    return {
      tokenAddress,
      walletAddress,
      balance,
      chain: 'polygon',
    };
  }

  // MULTI-CHAIN UTILITY
  @Get('supported-chains')
  async getSupportedChains() {
    return {
      chains: [
        {
          id: 'ethereum',
          name: 'Ethereum',
          rpc: process.env.ETHEREUM_RPC_SEPOLIA,
          explorer: 'https://sepolia.etherscan.io',
          testnet: true,
        },
        {
          id: 'polygon',
          name: 'Polygon',
          rpc: process.env.ETHEREUM_RPC_POLYGON,
          explorer: 'https://polygonscan.com',
          testnet: false,
        },
        {
          id: 'solana',
          name: 'Solana',
          rpc: process.env.SOLANA_RPC_DEVNET,
          explorer: 'https://explorer.solana.com',
          testnet: true,
        },
      ],
      total: 3,
    };
  }
}
