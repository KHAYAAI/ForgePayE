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
import { ethers } from 'ethers';
import type { Protocol, BaseYieldAdapter } from '../types';
export declare class OndoAdapter implements BaseYieldAdapter {
    private readonly provider;
    private readonly chain;
    readonly protocol: Protocol;
    private readonly http;
    constructor(provider: ethers.Provider, chain?: string);
    /**
     * Fetch the current USDY APY from the Ondo API.
     * Returns a decimal — e.g. 0.052 for 5.2 %.
     */
    getCurrentApy(): Promise<number>;
    /**
     * Initiate a USDY minting order via the Ondo institutional API.
     * The caller's wallet must be KYC-approved in the Ondo system.
     *
     * @param params.walletAddress  Destination wallet for minted USDY
     * @param params.amountUsd      USD amount to exchange for USDY
     * @param params.paymentMethod  'wire' | 'usdc' | 'usdt'
     * @returns Ondo order ID (use `getRedemptionStatus` to poll)
     */
    deposit(params: {
        walletAddress: string;
        amountUsd: number;
        paymentMethod: 'wire' | 'usdc' | 'usdt';
    }): Promise<string>;
    /**
     * Get the USDY balance for `address`.
     *
     * First tries the Ondo API (returns USD-denominated balance).
     * Falls back to a direct ERC-20 `balanceOf` call if the API fails.
     *
     * USDY has 18 decimals on Ethereum.
     */
    getBalance(address: string): Promise<number>;
    /**
     * Initiate a USDY redemption order.
     *
     * @param params.walletAddress  Source wallet holding USDY
     * @param params.amountUsdy     Amount of USDY to redeem
     * @param params.settlementRail 'wire' | 'usdc'
     * @returns Ondo redemption order ID
     */
    redeem(params: {
        walletAddress: string;
        amountUsdy: number;
        settlementRail: 'wire' | 'usdc';
    }): Promise<string>;
    /**
     * Poll the status of a mint or redemption order.
     */
    getRedemptionStatus(orderId: string): Promise<string>;
}
//# sourceMappingURL=ondo.d.ts.map