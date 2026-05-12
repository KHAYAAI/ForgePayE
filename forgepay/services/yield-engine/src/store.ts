/**
 * In-memory data store.
 *
 * PROD NOTE: Replace every Map/array here with:
 *   - PostgreSQL (via pg or Prisma) for durable records
 *   - Redis (via ioredis) for hot caches (APYs, positions)
 *
 * The Maps are keyed by entity ID (UUID strings).
 */

import type {
  YieldVault,
  YieldPosition,
  SweepConfig,
  YieldTransaction,
  Protocol,
  AssetSymbol,
  ChainName,
} from './types';

// ── Seed vault definitions ────────────────────────────────────────────────────
// These represent the initial vault catalogue.  APYs are refreshed by the
// cron job; everything else is semi-static configuration.

export const vaultsStore = new Map<string, YieldVault>([
  [
    'aave-v3-usdc-ethereum',
    {
      id:              'aave-v3-usdc-ethereum',
      protocol:        'aave_v3',
      name:            'Aave V3 USDC (Ethereum)',
      asset:           'USDC',
      chain:           'ethereum',
      contractAddress: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
      apy:             0.048,
      apyUpdatedAt:    new Date().toISOString(),
      tvl:             820_000_000,
      minDeposit:      100,
      withdrawalDelay: 'instant',
      riskLevel:       'low',
      audited:         true,
    },
  ],
  [
    'aave-v3-usdc-polygon',
    {
      id:              'aave-v3-usdc-polygon',
      protocol:        'aave_v3',
      name:            'Aave V3 USDC (Polygon)',
      asset:           'USDC',
      chain:           'polygon',
      contractAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      apy:             0.052,
      apyUpdatedAt:    new Date().toISOString(),
      tvl:             240_000_000,
      minDeposit:      10,
      withdrawalDelay: 'instant',
      riskLevel:       'low',
      audited:         true,
    },
  ],
  [
    'aave-v3-usdc-arbitrum',
    {
      id:              'aave-v3-usdc-arbitrum',
      protocol:        'aave_v3',
      name:            'Aave V3 USDC (Arbitrum)',
      asset:           'USDC',
      chain:           'arbitrum',
      contractAddress: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
      apy:             0.055,
      apyUpdatedAt:    new Date().toISOString(),
      tvl:             310_000_000,
      minDeposit:      10,
      withdrawalDelay: 'instant',
      riskLevel:       'low',
      audited:         true,
    },
  ],
  [
    'compound-v3-usdc-ethereum',
    {
      id:              'compound-v3-usdc-ethereum',
      protocol:        'compound_v3',
      name:            'Compound V3 USDC (Ethereum)',
      asset:           'USDC',
      chain:           'ethereum',
      contractAddress: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      apy:             0.043,
      apyUpdatedAt:    new Date().toISOString(),
      tvl:             540_000_000,
      minDeposit:      50,
      withdrawalDelay: 'instant',
      riskLevel:       'low',
      audited:         true,
    },
  ],
  [
    'compound-v3-usdc-polygon',
    {
      id:              'compound-v3-usdc-polygon',
      protocol:        'compound_v3',
      name:            'Compound V3 USDC (Polygon)',
      asset:           'USDC',
      chain:           'polygon',
      contractAddress: '0xF25212E676D1F7F89Cd72fFEe66158f541246445',
      apy:             0.045,
      apyUpdatedAt:    new Date().toISOString(),
      tvl:             85_000_000,
      minDeposit:      10,
      withdrawalDelay: 'instant',
      riskLevel:       'low',
      audited:         true,
    },
  ],
  [
    'ondo-usdy-ethereum',
    {
      id:              'ondo-usdy-ethereum',
      protocol:        'ondo_usdy',
      name:            'Ondo USDY (Ethereum)',
      asset:           'USDY',
      chain:           'ethereum',
      contractAddress: '0x96F6eF951840721AdBF46Ac996b59E0235CB985C',
      apy:             0.051,
      apyUpdatedAt:    new Date().toISOString(),
      tvl:             290_000_000,
      minDeposit:      1_000,
      withdrawalDelay: '24h',
      riskLevel:       'low',
      audited:         true,
    },
  ],
]);

// ── Runtime stores (PROD: PostgreSQL) ─────────────────────────────────────────

export const positionsStore  = new Map<string, YieldPosition>();
export const sweepConfigStore = new Map<string, SweepConfig>();
export const txStore          = new Map<string, YieldTransaction>();

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getVaultsByAsset(asset: AssetSymbol): YieldVault[] {
  return [...vaultsStore.values()].filter((v) => v.asset === asset);
}

export function getVaultsByProtocol(protocol: Protocol): YieldVault[] {
  return [...vaultsStore.values()].filter((v) => v.protocol === protocol);
}

export function getPositionsByMerchant(merchantId: string): YieldPosition[] {
  return [...positionsStore.values()].filter((p) => p.merchantId === merchantId);
}

export function getTxsByMerchant(merchantId: string): YieldTransaction[] {
  return [...txStore.values()]
    .filter((t) => t.merchantId === merchantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getSweepTxsByMerchant(merchantId: string): YieldTransaction[] {
  return getTxsByMerchant(merchantId).filter(
    (t) => t.type === 'auto_sweep' || t.type === 'deposit' || t.type === 'withdrawal',
  );
}
