/**
 * FORGE On-Chain Bridge
 * ──────────────────────────────────────────────────────────────────────────────
 * Wires the agent-credit-bureau Fastify service (Mode 1, off-chain) to the
 * FORGE Solidity contracts (Mode 2, on-chain) via viem.
 *
 * Connection map:
 *
 *   agent-credit-bureau (port 3018)
 *     │
 *     ├─ ForgeReputationRegistry  — read/write Mode 2 scores
 *     ├─ ForgeTransactionValidator — read on-chain tx stats for Mode 2 inputs
 *     ├─ ForgeBudgetEnforcer      — read agent budget status
 *     └─ ForgeCore                — executeAgentAction (the write path)
 *
 * Settlement flow (async, daily):
 *   1. settlement.ts reads all Mode 1 scores from the in-memory store
 *   2. Calls ForgeReputationRegistry.batchUpdateScores() via this client
 *   3. Settlement tx hash stored per-agent for dual-score endpoint
 *
 * Read flow (sync, per request):
 *   GET /v1/agents/:agentId/dual-score
 *   → reads ForgeTransactionValidator.getTransactionStats()
 *   → constructs Mode2Inputs
 *   → calls computeDualModeScore() with live Mode 1 + on-chain Mode 2 inputs
 *
 * Env vars required:
 *   CHAIN_RPC_URL            — Base Sepolia or Base Mainnet RPC
 *   SETTLEMENT_PRIVATE_KEY   — funded EOA with UPDATER_ROLE on ForgeReputationRegistry
 *                              and RECORDER_ROLE on ForgeTransactionValidator
 *   FORGE_REGISTRY_ADDRESS   — deployed ForgeReputationRegistry address
 *   FORGE_VALIDATOR_ADDRESS  — deployed ForgeTransactionValidator address
 *   FORGE_ENFORCER_ADDRESS   — deployed ForgeBudgetEnforcer address
 *   FORGE_CORE_ADDRESS       — deployed ForgeCore address
 *   CHAIN_ID                 — 84532 (Base Sepolia) or 8453 (Base Mainnet)
 */

import {
  createPublicClient, createWalletClient,
  http, webSocket, parseAbi,
  type Abi, type Address, type PublicClient, type WalletClient, type Account,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia, base } from 'viem/chains';
import type { Mode2Inputs } from './types';

// ── Contract ABIs (minimal — only what this service calls) ────────────────────

const REGISTRY_ABI = parseAbi([
  'function registerAgent(address agent) external',
  'function updateScore(address agent, uint16 newScore, bytes32 reason) external',
  'function batchUpdateScores(address[] calldata agents, uint16[] calldata scores, bytes32[] calldata reasons) external',
  'function getScore(address agent) external view returns (uint16)',
  'function getAgentDetails(address agent) external view returns (tuple(uint16 score, uint48 lastUpdated, uint32 updateCount, bool registered, bool frozen))',
  'function isRegistered(address agent) external view returns (bool)',
  'function isFrozen(address agent) external view returns (bool)',
  'function setFrozen(address agent, bool freeze, bytes32 reason) external',
]);

const VALIDATOR_ABI = parseAbi([
  'function recordTransaction(address agent, bytes32 txHash, uint256 amount, uint8 txType, bool success) external',
  'function getTransactionStats(address agent) external view returns (tuple(uint64 totalCount, uint128 totalVolume, uint64 successCount, uint64 failCount, uint48 lastActivityTimestamp))',
  'function getSuccessRate(address agent) external view returns (uint256)',
  'function isProcessed(bytes32 txHash) external view returns (bool)',
]);

const ENFORCER_ABI = parseAbi([
  'function checkBudget(address agent, uint128 amount) external view returns (bool)',
  'function getBudgetStatus(address agent) external view returns (tuple(uint128 dailyRemaining, uint128 monthlyRemaining, uint128 perTxLimit, uint128 dailySpent, uint128 monthlySpent))',
  'function hasBudget(address agent) external view returns (bool)',
]);

const CORE_ABI = parseAbi([
  'function executeAgentAction(address agent, bytes32 txHash, uint256 amount, uint8 txType, bool success) external',
  'function getAgentScore(address agent) external view returns (uint16)',
]);

// ── Chain detection ────────────────────────────────────────────────────────────

function resolveChain(chainId: number) {
  switch (chainId) {
    case 8453:  return base;
    case 84532: return baseSepolia;
    default:    return baseSepolia;
  }
}

// ── Client factory ────────────────────────────────────────────────────────────

export interface ForgeChainConfig {
  rpcUrl:              string;
  chainId:             number;
  settlementKey:       `0x${string}`;          // private key for settlement EOA
  registryAddress:     Address;
  validatorAddress:    Address;
  enforcerAddress:     Address;
  coreAddress:         Address;
}

export class ForgeChainClient {
  private public:  PublicClient;
  private wallet:  WalletClient;
  private account: Account;
  private cfg:     ForgeChainConfig;

  constructor(cfg: ForgeChainConfig) {
    this.cfg     = cfg;
    this.account = privateKeyToAccount(cfg.settlementKey);
    const chain  = resolveChain(cfg.chainId);

    this.public = createPublicClient({
      chain,
      transport: cfg.rpcUrl.startsWith('wss') ? webSocket(cfg.rpcUrl) : http(cfg.rpcUrl),
    });

    this.wallet = createWalletClient({
      chain,
      account:   this.account,
      transport: http(cfg.rpcUrl),
    });
  }

  // ── ForgeReputationRegistry reads ────────────────────────────────────────────

  async getOnChainScore(agentAddress: Address): Promise<number | null> {
    try {
      const score = await this.public.readContract({
        address: this.cfg.registryAddress,
        abi:     REGISTRY_ABI,
        functionName: 'getScore',
        args: [agentAddress],
      });
      return Number(score);
    } catch {
      return null; // agent not registered on-chain yet
    }
  }

  async isAgentRegistered(agentAddress: Address): Promise<boolean> {
    return this.public.readContract({
      address: this.cfg.registryAddress,
      abi:     REGISTRY_ABI,
      functionName: 'isRegistered',
      args: [agentAddress],
    });
  }

  async isAgentFrozen(agentAddress: Address): Promise<boolean> {
    return this.public.readContract({
      address: this.cfg.registryAddress,
      abi:     REGISTRY_ABI,
      functionName: 'isFrozen',
      args: [agentAddress],
    });
  }

  // ── ForgeReputationRegistry writes ───────────────────────────────────────────

  async registerAgentOnChain(agentAddress: Address): Promise<`0x${string}`> {
    return this.wallet.writeContract({
      address: this.cfg.registryAddress,
      abi:     REGISTRY_ABI,
      functionName: 'registerAgent',
      args: [agentAddress],
    });
  }

  async updateScoreOnChain(
    agentAddress: Address,
    score: number,
    reason: `0x${string}`,
  ): Promise<`0x${string}`> {
    return this.wallet.writeContract({
      address: this.cfg.registryAddress,
      abi:     REGISTRY_ABI,
      functionName: 'updateScore',
      args: [agentAddress, score, reason],
    });
  }

  /**
   * Batch-settle up to 100 Mode 1 scores on-chain in one tx.
   * Called by the settlement worker daily at 20:00 UTC.
   */
  async batchSettleScores(
    agents:  Address[],
    scores:  number[],
    reasons: `0x${string}`[],
  ): Promise<`0x${string}`> {
    if (agents.length === 0) throw new Error('batchSettleScores: empty batch');
    if (agents.length > 100) throw new Error('batchSettleScores: max 100 per batch');

    return this.wallet.writeContract({
      address: this.cfg.registryAddress,
      abi:     REGISTRY_ABI,
      functionName: 'batchUpdateScores',
      args: [agents, scores.map(s => s), reasons],
    });
  }

  async freezeAgentOnChain(
    agentAddress: Address,
    freeze: boolean,
    reason: `0x${string}`,
  ): Promise<`0x${string}`> {
    return this.wallet.writeContract({
      address: this.cfg.registryAddress,
      abi:     REGISTRY_ABI,
      functionName: 'setFrozen',
      args: [agentAddress, freeze, reason],
    });
  }

  // ── ForgeTransactionValidator reads ──────────────────────────────────────────

  /**
   * Read the on-chain transaction stats for an agent and translate them
   * into Mode2Inputs for the dual-mode scorer.
   *
   * @param agentAddress  Ethereum address bound to this agent DID
   * @param accountAgeMonths  Age from ForgeReputationRegistry.lastUpdated or profile.createdAt
   */
  async getMode2Inputs(
    agentAddress: Address,
    accountAgeMonths: number,
  ): Promise<Mode2Inputs | null> {
    try {
      const [stats, hasBudget] = await Promise.all([
        this.public.readContract({
          address: this.cfg.validatorAddress,
          abi:     VALIDATOR_ABI,
          functionName: 'getTransactionStats',
          args: [agentAddress],
        }),
        this.public.readContract({
          address: this.cfg.enforcerAddress,
          abi:     ENFORCER_ABI,
          functionName: 'hasBudget',
          args: [agentAddress],
        }),
      ]);

      const totalCount    = Number(stats.totalCount);
      const successCount  = Number(stats.successCount);
      const failCount     = Number(stats.failCount);
      const totalVolumeWei = stats.totalVolume;

      // Convert volume from wei to approximate USD (using ETH @ $2,500 for testnet)
      // In production this reads from a Chainlink price feed
      const ethPriceUsd    = Number(process.env['ETH_PRICE_USD'] ?? '2500');
      const totalVolumeUsd = Number(totalVolumeWei) / 1e18 * ethPriceUsd;

      // Success rate in basis points (10000 = 100%)
      const successRateBps = totalCount > 0
        ? Math.round((successCount / totalCount) * 10_000)
        : 10_000; // no history = neutral assumption

      // Budget compliance: (attempts - overages) / attempts
      // We approximate: if hasBudget=false, assume 100%; otherwise use
      // the ratio of recorded txs to total attempts (overages would revert so they
      // don't appear in totalCount). This is a conservative approximation.
      const budgetComplianceRate = hasBudget ? 0.95 : 1.0; // TODO: read from BudgetEnforcer events

      // Check if score is settled on-chain
      const onChainScore = await this.getOnChainScore(agentAddress);

      return {
        successRateBps,
        totalVolumeUsd,
        totalCount,
        budgetComplianceRate,
        accountAgeMonths,
        onChainSettled: onChainScore !== null,
        onChainScore:   onChainScore ?? undefined,
      };
    } catch {
      return null; // agent has no on-chain activity yet
    }
  }

  // ── ForgeCore writes ──────────────────────────────────────────────────────────

  /**
   * Execute an agent action through ForgeCore facade.
   * Validates budget, records tx in TransactionValidator, all in one call.
   */
  async executeAgentAction(
    agentAddress: Address,
    txHash:       `0x${string}`,
    amount:       bigint,
    txType:       number,  // TransactionType enum: 0=PAYMENT, 1=SWAP, 2=TRANSFER, 3=CONTRACT_CALL, 4=BRIDGE
    success:      boolean,
  ): Promise<`0x${string}`> {
    return this.wallet.writeContract({
      address: this.cfg.coreAddress,
      abi:     CORE_ABI,
      functionName: 'executeAgentAction',
      args: [agentAddress, txHash, amount, txType, success],
    });
  }

  // ── Tx receipt helper ─────────────────────────────────────────────────────────

  async waitForReceipt(txHash: `0x${string}`) {
    return this.public.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });
  }

  get chainId()  { return this.cfg.chainId; }
  get address()  { return this.account.address; }
}

// ── Singleton — created once at startup if env vars are present ───────────────

let _client: ForgeChainClient | null = null;

export function getChainClient(): ForgeChainClient | null {
  if (_client) return _client;

  const rpcUrl     = process.env['CHAIN_RPC_URL'];
  const key        = process.env['SETTLEMENT_PRIVATE_KEY'] as `0x${string}` | undefined;
  const registry   = process.env['FORGE_REGISTRY_ADDRESS']  as Address | undefined;
  const validator  = process.env['FORGE_VALIDATOR_ADDRESS'] as Address | undefined;
  const enforcer   = process.env['FORGE_ENFORCER_ADDRESS']  as Address | undefined;
  const core       = process.env['FORGE_CORE_ADDRESS']       as Address | undefined;
  const chainId    = parseInt(process.env['CHAIN_ID'] ?? '84532', 10);

  if (!rpcUrl || !key || !registry || !validator || !enforcer || !core) {
    // On-chain bridge is optional — service runs in off-chain only mode if unconfigured
    return null;
  }

  _client = new ForgeChainClient({
    rpcUrl, settlementKey: key, chainId,
    registryAddress:  registry,
    validatorAddress: validator,
    enforcerAddress:  enforcer,
    coreAddress:      core,
  });

  return _client;
}

/**
 * Derive an Ethereum address from an agent DID.
 * DID format: did:fp:0x<hex>  — the hex portion is the on-chain address.
 * Returns null if the DID doesn't contain a valid EVM address.
 */
export function didToAddress(did: string): Address | null {
  const match = did.match(/did:fp:(0x[0-9a-fA-F]{40})/);
  if (!match?.[1]) return null;
  return match[1] as Address;
}
