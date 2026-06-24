/**
 * Aave V3 adapter.
 *
 * Aave V3 uses an interest-bearing aToken model: when you supply 100 USDC you
 * receive 100 aUSDC, which accrues interest continuously.  The aToken balance
 * grows in real-time — no extra "claim" step needed.
 *
 * Key contracts per chain:
 *   Pool          – the main entry-point for supply/withdraw
 *   aToken        – rebasing receipt token, 1:1 with underlying at any moment
 *
 * APY calculation:
 *   Aave stores the liquidityRate as a 27-decimal fixed-point number ("ray").
 *   Annualised APY = (1 + liquidityRate / RAY / SECONDS_PER_YEAR)^SECONDS_PER_YEAR − 1
 *   For practical purposes: APY ≈ liquidityRate / RAY (already in annual terms
 *   for supply rate; the compounding effect adds ~0.1 % for typical rates).
 */
import { ethers } from 'ethers';
import type { Protocol, ChainName, BaseYieldAdapter } from '../types';
interface ChainAddresses {
    pool: string;
    /** Underlying asset (USDC) address on this chain */
    usdc: string;
    /** aUSDC token address */
    aUsdc: string;
}
export declare class AaveAdapter implements BaseYieldAdapter {
    private readonly provider;
    private readonly chain;
    readonly protocol: Protocol;
    private readonly pool;
    private readonly aToken;
    private readonly poolAddress;
    private readonly aTokenAddress;
    private readonly usdcAddress;
    constructor(provider: ethers.Provider, chain: ChainName);
    static isSupported(chain: ChainName): boolean;
    getChainAddresses(chain: ChainName): ChainAddresses | null;
    /**
     * Fetch the current supply APY for USDC on this chain.
     * Returns a decimal — e.g. 0.045 for 4.5 %.
     */
    getCurrentApy(asset?: string): Promise<number>;
    /**
     * Supply USDC to Aave V3.  The signer must hold sufficient USDC and have
     * approved the Pool contract to spend it.
     *
     * @returns on-chain transaction hash
     */
    deposit(signer: ethers.Signer, asset: string, amount: bigint): Promise<string>;
    /**
     * Withdraw USDC from Aave V3.
     * Pass ethers.MaxUint256 as amount to withdraw everything.
     *
     * @returns on-chain transaction hash
     */
    withdraw(signer: ethers.Signer, asset: string, amount: bigint): Promise<string>;
    /**
     * Return the aUSDC balance for `address`.
     * Because aTokens are 1:1 with the underlying, this equals the USDC value
     * including accrued interest.  Balance is in USDC units (6 decimals).
     */
    getBalance(address: string): Promise<number>;
}
export {};
//# sourceMappingURL=aave.d.ts.map