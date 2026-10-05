/**
 * Ondo Finance USDY adapter.
 *
 * USDY (US Dollar Yield) is a permissioned, yield-bearing stablecoin backed by
 * short-term US Treasury bills and bank demand deposits.  It is issued by Ondo
 * Finance on Ethereum and Mantle.
 *
 * Integration model:
 *   Ondo provides an institutional REST API for qualified counterparties.
 *   All calls require an API key (ONDO_API_KEY env var).
 *   On-chain balance queries use the USDY ERC-20 token directly.
 *
 * USDY contract addresses:
 *   Ethereum: 0x96F6eF951840721AdBF46Ac996b59E0235CB985C
 *   Mantle:   0x5bE26527e817998A7206475496fDE1E68957c5A6
 *
 * Note: Direct minting/redemption of USDY is gated by KYC/AML compliance;
 * only approved institutional wallets may interact with the USDY smart contract
 * directly. The Ondo API abstracts this for qualified partners.
 */

import axios, { AxiosError } from 'axios';
import { ethers } from 'ethers';
import type { Protocol, BaseYieldAdapter } from '../types';
import { config } from '../config';

// ── Minimal USDY ABI (standard ERC-20) ───────────────────────────────────────

const USDY_ABI = [
  'function balanceOf(address account) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

// ── USDY token addresses ──────────────────────────────────────────────────────

const USDY_ADDRESSES: Record<string, string> = {
  ethereum: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
  mantle:   '0x5bE26527e817998A7206475496fDE1E68957c5A6',
};

// ── Response types from the Ondo Finance API ──────────────────────────────────

interface OndoRatesResponse {
  asset:     string;
  apy:       number;   // e.g. 0.052 for 5.2 %
  updatedAt: string;
}

interface OndoDepositResponse {
  orderId:   string;
  status:    'pending' | 'processing' | 'completed' | 'failed';
  txHash?:   string;
  createdAt: string;
}

interface OndoPositionResponse {
  address:      string;
  balanceUsd:   number;
  balanceUsdy:  number;
  updatedAt:    string;
}

interface OndoRedemptionResponse {
  orderId:   string;
  status:    'pending' | 'processing' | 'completed' | 'failed';
  txHash?:   string;
}

export class OndoNotIntegratedError extends Error {
  constructor(what: string) {
    super(`Ondo USDY ${what}: not integrated. FORGE has no confirmed Ondo API access or KYC onboarding.`);
    this.name = 'OndoNotIntegratedError';
  }
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class OndoAdapter implements BaseYieldAdapter {
  readonly protocol: Protocol = 'ondo_usdy';

  private readonly http = axios.create({
    baseURL: config.ondoApiBase,
    timeout: 15_000,
    headers: {
      Authorization: `Bearer ${config.ondoApiKey}`,
      'Content-Type':  'application/json',
      'X-API-Version': '1',
    },
  });

  constructor(
    private readonly provider: ethers.Provider,
    private readonly chain: string = 'ethereum',
  ) {}

  // Every method refuses. The REST endpoints this adapter called
  // (/rates/usdy, /deposits, /positions, /redemptions, /orders on
  // api.ondo.finance/v1) were never confirmed against any Ondo API, USDY
  // minting and redemption are gated by Ondo's own KYC onboarding, which
  // FORGE has not done, and the old balance fallback priced USDY at $1 when it
  // is an accruing token worth more. Until a real integration exists, nothing
  // here may report a rate, a balance or an order.

  async getCurrentApy(): Promise<number> {
    throw new OndoNotIntegratedError('APY');
  }

  async deposit(_params: {
    walletAddress: string;
    amountUsd: number;
    paymentMethod: 'wire' | 'usdc' | 'usdt';
  }): Promise<string> {
    throw new OndoNotIntegratedError('deposits');
  }

  async getBalance(_address: string): Promise<number> {
    throw new OndoNotIntegratedError('balances');
  }

  async redeem(_params: {
    walletAddress: string;
    amountUsdy: number;
    settlementRail: 'wire' | 'usdc';
  }): Promise<string> {
    throw new OndoNotIntegratedError('redemptions');
  }

  async getRedemptionStatus(_orderId: string): Promise<string> {
    throw new OndoNotIntegratedError('order status');
  }
}
