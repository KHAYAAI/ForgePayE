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

  /**
   * Fetch the current USDY APY from the Ondo API.
   * Returns a decimal — e.g. 0.052 for 5.2 %.
   */
  async getCurrentApy(): Promise<number> {
    const resp = await this.http.get<OndoRatesResponse>('/rates/usdy');
    return resp.data.apy;
  }

  /**
   * Initiate a USDY minting order via the Ondo institutional API.
   * The caller's wallet must be KYC-approved in the Ondo system.
   *
   * @param params.walletAddress  Destination wallet for minted USDY
   * @param params.amountUsd      USD amount to exchange for USDY
   * @param params.paymentMethod  'wire' | 'usdc' | 'usdt'
   * @returns Ondo order ID (use `getRedemptionStatus` to poll)
   */
  async deposit(params: {
    walletAddress: string;
    amountUsd: number;
    paymentMethod: 'wire' | 'usdc' | 'usdt';
  }): Promise<string> {
    try {
      const resp = await this.http.post<OndoDepositResponse>('/deposits', {
        asset:         'USDY',
        walletAddress: params.walletAddress,
        amountUsd:     params.amountUsd,
        paymentMethod: params.paymentMethod,
      });
      return resp.data.orderId;
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        throw new Error(
          `Ondo deposit failed: ${err.response.status} — ${JSON.stringify(err.response.data)}`,
        );
      }
      throw err;
    }
  }

  /**
   * Get the USDY balance for `address`.
   *
   * First tries the Ondo API (returns USD-denominated balance).
   * Falls back to a direct ERC-20 `balanceOf` call if the API fails.
   *
   * USDY has 18 decimals on Ethereum.
   */
  async getBalance(address: string): Promise<number> {
    try {
      const resp = await this.http.get<OndoPositionResponse>(`/positions/${address}`);
      return resp.data.balanceUsd;
    } catch (_apiErr) {
      // Fall back to on-chain read
      const usdyAddress = USDY_ADDRESSES[this.chain];
      if (!usdyAddress) {
        throw new Error(`No USDY token address for chain: ${this.chain}`);
      }
      const token = new ethers.Contract(usdyAddress, USDY_ABI, this.provider);
      const raw   = await token['balanceOf'](address) as bigint;
      // USDY is pegged ~$1 and has 18 decimals; no oracle needed for a rough estimate
      return Number(raw) / 1e18;
    }
  }

  /**
   * Initiate a USDY redemption order.
   *
   * @param params.walletAddress  Source wallet holding USDY
   * @param params.amountUsdy     Amount of USDY to redeem
   * @param params.settlementRail 'wire' | 'usdc'
   * @returns Ondo redemption order ID
   */
  async redeem(params: {
    walletAddress: string;
    amountUsdy: number;
    settlementRail: 'wire' | 'usdc';
  }): Promise<string> {
    try {
      const resp = await this.http.post<OndoDepositResponse>('/redemptions', {
        asset:          'USDY',
        walletAddress:  params.walletAddress,
        amountUsdy:     params.amountUsdy,
        settlementRail: params.settlementRail,
      });
      return resp.data.orderId;
    } catch (err) {
      if (err instanceof AxiosError && err.response) {
        throw new Error(
          `Ondo redemption failed: ${err.response.status} — ${JSON.stringify(err.response.data)}`,
        );
      }
      throw err;
    }
  }

  /**
   * Poll the status of a mint or redemption order.
   */
  async getRedemptionStatus(orderId: string): Promise<string> {
    const resp = await this.http.get<OndoRedemptionResponse>(`/orders/${orderId}`);
    return resp.data.status;
  }
}
