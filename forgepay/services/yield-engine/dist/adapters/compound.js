"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompoundAdapter = void 0;
const ethers_1 = require("ethers");
// ── Minimal Comet ABI ─────────────────────────────────────────────────────────
const COMET_ABI = [
    // supply(asset, amount) — deposit `amount` of `asset`
    'function supply(address asset, uint256 amount)',
    // withdraw(asset, amount) — redeem supplied assets
    'function withdraw(address asset, uint256 amount)',
    // balanceOf(account) — current supply balance including interest
    'function balanceOf(address account) view returns (uint256)',
    // getUtilization() — current borrow utilization (scaled 1e18)
    'function getUtilization() view returns (uint256)',
    // getSupplyRate(utilization) → per-second supply rate (scaled 1e18)
    'function getSupplyRate(uint256 utilization) view returns (uint64)',
    // baseToken() → address of the base asset (e.g. USDC)
    'function baseToken() view returns (address)',
];
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
];
const COMET_ADDRESSES = {
    ethereum: {
        comet: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
        usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    },
    polygon: {
        // Compound V3 USDC on Polygon
        comet: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
        usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
    },
    arbitrum: {
        comet: '0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA',
        usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
    },
    // Compound V3 is not deployed on Base at the time of writing.
    base: null,
};
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
// ── Adapter ───────────────────────────────────────────────────────────────────
class CompoundAdapter {
    provider;
    chain;
    protocol = 'compound_v3';
    comet;
    cometAddress;
    usdcAddress;
    constructor(provider, chain) {
        this.provider = provider;
        this.chain = chain;
        const addrs = COMET_ADDRESSES[chain];
        if (!addrs) {
            throw new Error(`Compound V3 is not supported on chain: ${chain}`);
        }
        this.cometAddress = addrs.comet;
        this.usdcAddress = addrs.usdc;
        this.comet = new ethers_1.ethers.Contract(addrs.comet, COMET_ABI, provider);
    }
    static isSupported(chain) {
        return COMET_ADDRESSES[chain] !== null;
    }
    /**
     * Fetch the current supply APY from the Comet contract.
     * Returns a decimal — e.g. 0.05 for 5 %.
     */
    async getCurrentApy() {
        const utilization = await this.comet['getUtilization']();
        const supplyRateRaw = await this.comet['getSupplyRate'](utilization);
        // supplyRate is per-second, scaled by 1e18
        const ratePerSecond = Number(supplyRateRaw) / 1e18;
        const apy = (1 + ratePerSecond) ** SECONDS_PER_YEAR - 1;
        return apy;
    }
    /**
     * Supply USDC to Compound V3.
     * The signer must hold USDC and the Comet contract must be approved to
     * pull it.
     *
     * @returns on-chain transaction hash
     */
    async deposit(signer, amount) {
        // Approve Comet to pull USDC
        const erc20 = new ethers_1.ethers.Contract(this.usdcAddress, ERC20_ABI, signer);
        const approveTx = await erc20['approve'](this.cometAddress, amount);
        await approveTx.wait(1);
        const cometWithSigner = this.comet.connect(signer);
        const tx = await cometWithSigner['supply'](this.usdcAddress, amount);
        const receipt = await tx.wait(1);
        if (!receipt)
            throw new Error('supply transaction receipt is null');
        return receipt.hash;
    }
    /**
     * Withdraw USDC from Compound V3.
     * Pass the exact amount in USDC base units (1e6 per dollar).
     *
     * @returns on-chain transaction hash
     */
    async withdraw(signer, amount) {
        const cometWithSigner = this.comet.connect(signer);
        const tx = await cometWithSigner['withdraw'](this.usdcAddress, amount);
        const receipt = await tx.wait(1);
        if (!receipt)
            throw new Error('withdraw transaction receipt is null');
        return receipt.hash;
    }
    /**
     * Return the supplied USDC balance (including accrued interest) for `address`.
     * The Comet contract returns balances in USDC base units (1e6 per dollar).
     */
    async getBalance(address) {
        const raw = await this.comet['balanceOf'](address);
        return Number(raw) / 1e6;
    }
}
exports.CompoundAdapter = CompoundAdapter;
//# sourceMappingURL=compound.js.map