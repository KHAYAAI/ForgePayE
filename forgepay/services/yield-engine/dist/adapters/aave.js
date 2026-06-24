"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AaveAdapter = void 0;
const ethers_1 = require("ethers");
// ── Minimal ABIs ──────────────────────────────────────────────────────────────
const POOL_ABI = [
    // supply(asset, amount, onBehalfOf, referralCode)
    'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
    // withdraw(asset, amount, to) returns (uint256 amountWithdrawn)
    'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
    // getReserveData(asset) returns (DataTypes.ReserveData)
    // We only destructure the first 3 fields; everything else is ignored.
    `function getReserveData(address asset) view returns (
      uint256 configuration,
      uint128 liquidityIndex,
      uint128 currentLiquidityRate,
      uint128 variableBorrowIndex,
      uint128 currentVariableBorrowRate,
      uint128 currentStableBorrowRate,
      uint40  lastUpdateTimestamp,
      uint16  id,
      address aTokenAddress,
      address stableDebtTokenAddress,
      address variableDebtTokenAddress,
      address interestRateStrategyAddress,
      uint128 accruedToTreasury,
      uint128 unbacked,
      uint128 isolationModeTotalDebt
  )`,
];
const ATOKEN_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
];
const ERC20_ABI = [
    'function approve(address spender, uint256 amount) returns (bool)',
];
const CHAIN_ADDRESSES = {
    ethereum: {
        pool: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
        usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        aUsdc: '0x98C23E9d8f34FEFb1B7BD6a91B7FF122F4e16F5c',
    },
    polygon: {
        pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        usdc: '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
        aUsdc: '0x625E7708f30cA75bfd92586e17077590C60eb4cD',
    },
    arbitrum: {
        pool: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
        usdc: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
        aUsdc: '0x625E7708f30cA75bfd92586e17077590C60eb4cD',
    },
    // Aave V3 is not yet fully deployed on Base mainnet as of the time of
    // writing; return null so the factory skips it.
    base: null,
};
// 1 ray = 1e27
const RAY = BigInt('1000000000000000000000000000');
const SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60;
// ── Adapter ───────────────────────────────────────────────────────────────────
class AaveAdapter {
    provider;
    chain;
    protocol = 'aave_v3';
    pool;
    aToken;
    poolAddress;
    aTokenAddress;
    usdcAddress;
    constructor(provider, chain) {
        this.provider = provider;
        this.chain = chain;
        const addrs = CHAIN_ADDRESSES[chain];
        if (!addrs) {
            throw new Error(`Aave V3 is not supported on chain: ${chain}`);
        }
        this.poolAddress = addrs.pool;
        this.aTokenAddress = addrs.aUsdc;
        this.usdcAddress = addrs.usdc;
        this.pool = new ethers_1.ethers.Contract(addrs.pool, POOL_ABI, provider);
        this.aToken = new ethers_1.ethers.Contract(addrs.aUsdc, ATOKEN_ABI, provider);
    }
    static isSupported(chain) {
        return CHAIN_ADDRESSES[chain] !== null;
    }
    getChainAddresses(chain) {
        return CHAIN_ADDRESSES[chain];
    }
    /**
     * Fetch the current supply APY for USDC on this chain.
     * Returns a decimal — e.g. 0.045 for 4.5 %.
     */
    async getCurrentApy(asset) {
        const targetAsset = asset ?? this.usdcAddress;
        const data = await this.pool['getReserveData'](targetAsset);
        // liquidityRate is a 27-decimal ray; divide to get the per-second rate,
        // then annualise.  We use a continuous-compounding formula for precision.
        const liquidityRateRay = data.currentLiquidityRate;
        const ratePerSecond = Number(liquidityRateRay) / Number(RAY) / SECONDS_PER_YEAR;
        // APY = e^(rate_per_second * seconds_per_year) - 1
        const apy = Math.exp(ratePerSecond * SECONDS_PER_YEAR) - 1;
        return apy;
    }
    /**
     * Supply USDC to Aave V3.  The signer must hold sufficient USDC and have
     * approved the Pool contract to spend it.
     *
     * @returns on-chain transaction hash
     */
    async deposit(signer, asset, amount) {
        // 1. Approve Pool to pull USDC from the signer
        const erc20 = new ethers_1.ethers.Contract(asset, ERC20_ABI, signer);
        const approveTx = await erc20['approve'](this.poolAddress, amount);
        await approveTx.wait(1);
        // 2. supply(asset, amount, onBehalfOf, referralCode=0)
        const poolWithSigner = this.pool.connect(signer);
        const signerAddress = await signer.getAddress();
        const supplyTx = await poolWithSigner['supply'](asset, amount, signerAddress, 0);
        const receipt = await supplyTx.wait(1);
        if (!receipt)
            throw new Error('supply transaction receipt is null');
        return receipt.hash;
    }
    /**
     * Withdraw USDC from Aave V3.
     * Pass ethers.MaxUint256 as amount to withdraw everything.
     *
     * @returns on-chain transaction hash
     */
    async withdraw(signer, asset, amount) {
        const poolWithSigner = this.pool.connect(signer);
        const signerAddress = await signer.getAddress();
        const tx = await poolWithSigner['withdraw'](asset, amount, signerAddress);
        const receipt = await tx.wait(1);
        if (!receipt)
            throw new Error('withdraw transaction receipt is null');
        return receipt.hash;
    }
    /**
     * Return the aUSDC balance for `address`.
     * Because aTokens are 1:1 with the underlying, this equals the USDC value
     * including accrued interest.  Balance is in USDC units (6 decimals).
     */
    async getBalance(address) {
        const rawBalance = await this.aToken['balanceOf'](address);
        // USDC has 6 decimals
        return Number(rawBalance) / 1e6;
    }
}
exports.AaveAdapter = AaveAdapter;
//# sourceMappingURL=aave.js.map