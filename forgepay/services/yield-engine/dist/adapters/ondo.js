"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.OndoAdapter = void 0;
const axios_1 = __importStar(require("axios"));
const ethers_1 = require("ethers");
const config_1 = require("../config");
// ── Minimal USDY ABI (standard ERC-20) ───────────────────────────────────────
const USDY_ABI = [
    'function balanceOf(address account) view returns (uint256)',
    'function decimals() view returns (uint8)',
];
// ── USDY token addresses ──────────────────────────────────────────────────────
const USDY_ADDRESSES = {
    ethereum: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
    mantle: '0x5bE26527e817998A7206475496fDE1E68957c5A6',
};
// ── Adapter ───────────────────────────────────────────────────────────────────
class OndoAdapter {
    provider;
    chain;
    protocol = 'ondo_usdy';
    http = axios_1.default.create({
        baseURL: config_1.config.ondoApiBase,
        timeout: 15_000,
        headers: {
            Authorization: `Bearer ${config_1.config.ondoApiKey}`,
            'Content-Type': 'application/json',
            'X-API-Version': '1',
        },
    });
    constructor(provider, chain = 'ethereum') {
        this.provider = provider;
        this.chain = chain;
    }
    /**
     * Fetch the current USDY APY from the Ondo API.
     * Returns a decimal — e.g. 0.052 for 5.2 %.
     */
    async getCurrentApy() {
        const resp = await this.http.get('/rates/usdy');
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
    async deposit(params) {
        try {
            const resp = await this.http.post('/deposits', {
                asset: 'USDY',
                walletAddress: params.walletAddress,
                amountUsd: params.amountUsd,
                paymentMethod: params.paymentMethod,
            });
            return resp.data.orderId;
        }
        catch (err) {
            if (err instanceof axios_1.AxiosError && err.response) {
                throw new Error(`Ondo deposit failed: ${err.response.status} — ${JSON.stringify(err.response.data)}`);
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
    async getBalance(address) {
        try {
            const resp = await this.http.get(`/positions/${address}`);
            return resp.data.balanceUsd;
        }
        catch (_apiErr) {
            // Fall back to on-chain read
            const usdyAddress = USDY_ADDRESSES[this.chain];
            if (!usdyAddress) {
                throw new Error(`No USDY token address for chain: ${this.chain}`);
            }
            const token = new ethers_1.ethers.Contract(usdyAddress, USDY_ABI, this.provider);
            const raw = await token['balanceOf'](address);
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
    async redeem(params) {
        try {
            const resp = await this.http.post('/redemptions', {
                asset: 'USDY',
                walletAddress: params.walletAddress,
                amountUsdy: params.amountUsdy,
                settlementRail: params.settlementRail,
            });
            return resp.data.orderId;
        }
        catch (err) {
            if (err instanceof axios_1.AxiosError && err.response) {
                throw new Error(`Ondo redemption failed: ${err.response.status} — ${JSON.stringify(err.response.data)}`);
            }
            throw err;
        }
    }
    /**
     * Poll the status of a mint or redemption order.
     */
    async getRedemptionStatus(orderId) {
        const resp = await this.http.get(`/orders/${orderId}`);
        return resp.data.status;
    }
}
exports.OndoAdapter = OndoAdapter;
//# sourceMappingURL=ondo.js.map