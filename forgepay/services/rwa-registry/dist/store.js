"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redemptionRequests = exports.incomeDistributions = exports.positionsByMerchant = exports.positions = exports.rwaAssets = void 0;
exports.getPositionsForMerchant = getPositionsForMerchant;
exports.addPosition = addPosition;
const uuid_1 = require("uuid");
// ── In-memory stores ──────────────────────────────────────────────────────────
exports.rwaAssets = new Map();
exports.positions = new Map(); // key: positionId
exports.positionsByMerchant = new Map(); // merchantId -> positionIds
exports.incomeDistributions = new Map(); // key: distributionId
exports.redemptionRequests = new Map(); // key: requestId
// ── Seed data: 6 real RWA assets (May 2026 realistic data) ───────────────────
const NOW = new Date().toISOString();
const seedAssets = [
    {
        name: 'Ondo US Dollar Yield',
        symbol: 'USDY',
        issuer: 'Ondo Finance',
        assetClass: 'treasury_bill',
        description: 'Tokenized note backed by US Treasuries and bank demand deposits. Accrues yield daily and is redeemable for USDC.',
        currentApyBps: 520,
        historicalApy30dBps: 515,
        historicalApy90dBps: 512,
        yieldFrequency: 'daily',
        incomeType: 'interest',
        taxTreatment: 'ordinary_income',
        redemptionSpeed: 'next_day',
        minimumInvestmentUsd: 500,
        minimumRedemptionUsd: 500,
        redemptionFeePercent: 0,
        contractAddress: '0x96F6ef951840721AdBF46Ac996b59E0235CB985C',
        chain: 'ethereum',
        requiresKyc: true,
        requiresAccreditedInvestor: false,
        supportedJurisdictions: ['US', 'EU', 'SG', 'GB'],
        status: 'active',
        totalAumUsd: 680_000_000,
        nav: 1.00,
    },
    {
        name: 'Franklin OnChain US Government Money Fund',
        symbol: 'FOBXX',
        issuer: 'Franklin Templeton',
        assetClass: 'money_market',
        description: 'SEC-registered money market fund tokenized on Stellar. Invests in US government securities with same-day liquidity.',
        currentApyBps: 505,
        historicalApy30dBps: 502,
        historicalApy90dBps: 498,
        yieldFrequency: 'daily',
        incomeType: 'dividend',
        taxTreatment: 'qualified_dividend',
        redemptionSpeed: 'same_day',
        minimumInvestmentUsd: 1_000,
        minimumRedemptionUsd: 1_000,
        redemptionFeePercent: 0,
        chain: 'stellar',
        requiresKyc: true,
        requiresAccreditedInvestor: false,
        supportedJurisdictions: ['all'],
        status: 'active',
        totalAumUsd: 1_200_000_000,
        nav: 1.00,
    },
    {
        name: 'OpenEden T-Bill Vault',
        symbol: 'TBILL',
        issuer: 'OpenEden',
        assetClass: 'treasury_bill',
        description: 'On-chain tokenized T-bill vault backed 1:1 by US 3-month Treasury bills. Highest yield among accessible T-bill products.',
        currentApyBps: 530,
        historicalApy30dBps: 525,
        historicalApy90dBps: 518,
        yieldFrequency: 'daily',
        incomeType: 'interest',
        taxTreatment: 'ordinary_income',
        redemptionSpeed: 'next_day',
        minimumInvestmentUsd: 100,
        minimumRedemptionUsd: 100,
        redemptionFeePercent: 0,
        contractAddress: '0xdd50C053C096CB04A3e3362E2b622529EC5f2e8a',
        chain: 'ethereum',
        requiresKyc: true,
        requiresAccreditedInvestor: false,
        supportedJurisdictions: ['all'],
        status: 'active',
        totalAumUsd: 450_000_000,
        nav: 1.0002,
    },
    {
        name: 'BlackRock USD Institutional Digital Liquidity Fund',
        symbol: 'BUIDL',
        issuer: 'BlackRock',
        assetClass: 'money_market',
        description: 'Institutional tokenized money market fund by BlackRock on Ethereum. Invests in cash, US Treasury bills, and repurchase agreements.',
        currentApyBps: 500,
        historicalApy30dBps: 498,
        historicalApy90dBps: 495,
        yieldFrequency: 'monthly',
        incomeType: 'dividend',
        taxTreatment: 'qualified_dividend',
        redemptionSpeed: 'T+2',
        minimumInvestmentUsd: 5_000_000,
        minimumRedemptionUsd: 250_000,
        redemptionFeePercent: 0,
        contractAddress: '0x7712c34205737192402172409a8F7ccef8aA2AEc',
        chain: 'ethereum',
        requiresKyc: true,
        requiresAccreditedInvestor: true,
        supportedJurisdictions: ['US'],
        status: 'active',
        totalAumUsd: 2_800_000_000,
        nav: 1.00,
    },
    {
        name: 'Ondo Short-Term US Government Bond Fund',
        symbol: 'OUSG',
        issuer: 'Ondo Finance',
        assetClass: 'treasury_bill',
        description: 'Tokenized short-term US government bond fund with instant redemption via USDC liquidity pool. Accredited investors only.',
        currentApyBps: 515,
        historicalApy30dBps: 512,
        historicalApy90dBps: 508,
        yieldFrequency: 'daily',
        incomeType: 'interest',
        taxTreatment: 'ordinary_income',
        redemptionSpeed: 'instant',
        minimumInvestmentUsd: 5_000,
        minimumRedemptionUsd: 5_000,
        redemptionFeePercent: 0,
        contractAddress: '0x1B19C19393e2d034D8Ff31ff34c81252FcBb37c',
        chain: 'ethereum',
        requiresKyc: true,
        requiresAccreditedInvestor: true,
        supportedJurisdictions: ['US', 'EU', 'SG', 'GB', 'CA', 'AU'],
        status: 'active',
        totalAumUsd: 890_000_000,
        nav: 105.23,
    },
    {
        name: 'Superstate Short Duration US Government Securities Fund',
        symbol: 'USTB',
        issuer: 'Superstate',
        assetClass: 'treasury_bill',
        description: 'Tokenized US Treasury fund by Superstate. SEC-regulated, targeting non-accredited qualified purchasers. Broad institutional access.',
        currentApyBps: 518,
        historicalApy30dBps: 514,
        historicalApy90dBps: 510,
        yieldFrequency: 'daily',
        incomeType: 'interest',
        taxTreatment: 'ordinary_income',
        redemptionSpeed: 'next_day',
        minimumInvestmentUsd: 1_000,
        minimumRedemptionUsd: 1_000,
        redemptionFeePercent: 0,
        contractAddress: '0x43415eB6ff9DB7E26A15b704e7A3eDCe97d0BC6',
        chain: 'ethereum',
        requiresKyc: true,
        requiresAccreditedInvestor: false,
        supportedJurisdictions: ['US', 'EU', 'GB', 'SG', 'HK', 'JP'],
        status: 'active',
        totalAumUsd: 320_000_000,
        nav: 10.05,
    },
];
// Seed assets into the map
for (const asset of seedAssets) {
    const id = (0, uuid_1.v4)();
    exports.rwaAssets.set(id, {
        ...asset,
        id,
        navUpdatedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
    });
}
// ── Helper: get position by merchant ─────────────────────────────────────────
function getPositionsForMerchant(merchantId) {
    const ids = exports.positionsByMerchant.get(merchantId) ?? [];
    return ids.map(id => exports.positions.get(id)).filter((p) => p !== undefined);
}
function addPosition(position) {
    exports.positions.set(position.id, position);
    const existing = exports.positionsByMerchant.get(position.merchantId) ?? [];
    exports.positionsByMerchant.set(position.merchantId, [...existing, position.id]);
}
//# sourceMappingURL=store.js.map