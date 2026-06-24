/**
 * Compound V3 (Comet) adapter.
 *
 * Compound V3 uses a single-asset lending model per "Comet" contract.
 * The USDC Comet on mainnet: 0xc3d688B66703497DAA19211EEdff47f25384cdc3
 *
 * Unlike Compound V2, V3 does NOT issue cTokens.  Instead it tracks balances
 * internally — `balanceOf(address)` returns the current supplied principal plus
 * accrued interest directly in USDC base units.
 *
 * APY calculation:
 *   Comet exposes `getSupplyRate(utilization)` → per-second rate (scaled 1e18).
 *   APY = (1 + supplyRate / 1e18)^SECONDS_PER_YEAR − 1
 */
import { ethers } from 'ethers';
import type { Protocol, ChainName, BaseYieldAdapter } from '../types';
export declare class CompoundAdapter implements BaseYieldAdapter {
    private readonly provider;
    private readonly chain;
    readonly protocol: Protocol;
    private readonly comet;
    private readonly cometAddress;
    private readonly usdcAddress;
    constructor(provider: ethers.Provider, chain: ChainName);
    static isSupported(chain: ChainName): boolean;
    /**
     * Fetch the current supply APY from the Comet contract.
     * Returns a decimal — e.g. 0.05 for 5 %.
     */
    getCurrentApy(): Promise<number>;
    /**
     * Supply USDC to Compound V3.
     * The signer must hold USDC and the Comet contract must be approved to
     * pull it.
     *
     * @returns on-chain transaction hash
     */
    deposit(signer: ethers.Signer, amount: bigint): Promise<string>;
    /**
     * Withdraw USDC from Compound V3.
     * Pass the exact amount in USDC base units (1e6 per dollar).
     *
     * @returns on-chain transaction hash
     */
    withdraw(signer: ethers.Signer, amount: bigint): Promise<string>;
    /**
     * Return the supplied USDC balance (including accrued interest) for `address`.
     * The Comet contract returns balances in USDC base units (1e6 per dollar).
     */
    getBalance(address: string): Promise<number>;
}
//# sourceMappingURL=compound.d.ts.map