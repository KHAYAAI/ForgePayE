import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { ethers } from 'ethers';

interface StakingInfo {
  stakedAmount: string;
  rewards: string;
  apy: string;
  tvl: string;
}

interface StakeTx {
  to: string;
  data: string;
  value: string;
  gas: string;
  gasPrice: string;
}

interface UnstakeTx {
  to: string;
  data: string;
  gas: string;
  gasPrice: string;
}

@Injectable()
export class StakingService {
  private readonly lidoAddress = '0xae7ab96520DE3A18E5e111B5eaAb095312D7fE84'; // Lido stETH on mainnet
  private readonly lidoRpcUrl = process.env.ETHEREUM_RPC_URL || 'https://eth-mainnet.g.alchemy.com/v2/demo';

  // Lido stETH contract ABI (simplified)
  private readonly stethAbi = [
    'function submit(address _referral) public payable returns (uint256)',
    'function balanceOf(address account) public view returns (uint256)',
    'function approve(address spender, uint256 amount) public returns (bool)',
    'function transfer(address to, uint256 amount) public returns (bool)',
  ];

  // Lido Withdrawal Queue ABI (simplified)
  private readonly withdrawalQueueAbi = [
    'function requestWithdrawals(uint256[] calldata amounts, address _owner) public returns (uint256[] memory requestIds)',
  ];

  constructor(private httpService: HttpService) {}

  async getStakingInfo(walletAddress: string): Promise<StakingInfo> {
    try {
      const provider = new ethers.JsonRpcProvider(this.lidoRpcUrl);
      const stethContract = new ethers.Contract(
        this.lidoAddress,
        this.stethAbi,
        provider,
      );

      // Get staked amount (stETH balance)
      const stakedAmount = await stethContract.balanceOf(walletAddress);

      // Get current APY from Lido's API
      const apy = await this.getLidoAPY();

      // Calculate estimated rewards (simplified)
      const rewards = this.calculateRewards(
        stakedAmount.toString(),
        apy,
      );

      // Get TVL from Lido's API
      const tvl = await this.getLidoTVL();

      return {
        stakedAmount: ethers.formatEther(stakedAmount),
        rewards: ethers.formatEther(rewards),
        apy: apy,
        tvl: tvl,
      };
    } catch (error) {
      throw new Error(`Failed to get staking info: ${error.message}`);
    }
  }

  async buildStakeTx(
    walletAddress: string,
    amountInEth: string,
  ): Promise<StakeTx> {
    try {
      const provider = new ethers.JsonRpcProvider(this.lidoRpcUrl);
      const stethContract = new ethers.Contract(
        this.lidoAddress,
        this.stethAbi,
        provider,
      );

      // Build submit transaction
      const amount = ethers.parseEther(amountInEth);
      const gasPrice = await provider.getGasPrice();
      const gasEstimate = await stethContract.submit.estimateGas(ethers.ZeroAddress, {
        value: amount,
      });

      return {
        to: this.lidoAddress,
        data: stethContract.interface.encodeFunctionData('submit', [ethers.ZeroAddress]),
        value: amount.toString(),
        gas: gasEstimate.toString(),
        gasPrice: gasPrice.toString(),
      };
    } catch (error) {
      throw new Error(`Failed to build stake transaction: ${error.message}`);
    }
  }

  async buildUnstakeTx(
    walletAddress: string,
    stethAmount: string,
  ): Promise<UnstakeTx> {
    try {
      const provider = new ethers.JsonRpcProvider(this.lidoRpcUrl);
      const withdrawalQueueAddress = '0x889edC2eDab5f40e902b864aD4d7AdE30b7a7592';
      const withdrawalQueue = new ethers.Contract(
        withdrawalQueueAddress,
        this.withdrawalQueueAbi,
        provider,
      );

      const amount = ethers.parseEther(stethAmount);
      const gasPrice = await provider.getGasPrice();
      const gasEstimate = await withdrawalQueue.requestWithdrawals.estimateGas(
        [amount],
        walletAddress,
      );

      return {
        to: withdrawalQueueAddress,
        data: withdrawalQueue.interface.encodeFunctionData('requestWithdrawals', [
          [amount],
          walletAddress,
        ]),
        gas: gasEstimate.toString(),
        gasPrice: gasPrice.toString(),
      };
    } catch (error) {
      throw new Error(`Failed to build unstake transaction: ${error.message}`);
    }
  }

  async getLidoAPY(): Promise<string> {
    try {
      // In production, fetch from Lido's API or off-chain data
      // For now, return a mock value
      return '3.84';
    } catch (error) {
      return '0';
    }
  }

  async getLidoTVL(): Promise<string> {
    try {
      // In production, fetch actual TVL
      // For now, return a mock value
      return '26500000000'; // $26.5B in wei
    } catch (error) {
      return '0';
    }
  }

  private calculateRewards(
    stakedAmount: string,
    apy: string,
  ): ethers.BigNumberish {
    // Simplified reward calculation (annual rewards / 365 days)
    const amount = ethers.parseEther(stakedAmount);
    const apyDecimal = parseFloat(apy) / 100;
    const dailyReward = (BigInt(amount.toString()) * BigInt(Math.floor(apyDecimal * 10000))) / BigInt(1000000) / BigInt(365);
    return dailyReward;
  }
}
