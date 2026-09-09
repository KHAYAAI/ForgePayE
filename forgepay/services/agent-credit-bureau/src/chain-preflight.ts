/**
 * Is this service pointed at the chain its operator thinks it is?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The failure this exists to prevent
 *
 * `CHAIN_ID` defaults to 84532 — Base Sepolia. That default is right for a
 * developer and wrong for a production deployment, and it is silent: a
 * mainnet rollout that sets CHAIN_RPC_URL and the five contract addresses but
 * forgets CHAIN_ID keeps settling Mode 2 scores to a testnet. Nothing errors.
 * The dual-score endpoint keeps returning a settled score with a transaction
 * hash and a block number, and every one of them points at a network where
 * the numbers mean nothing.
 *
 * A lender reading that score cannot tell. It is a settled, verifiable,
 * on-chain record — of a testnet.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * What is checked
 *
 * Configuration is compared against the chain itself rather than against
 * another piece of configuration. Anything self-consistent but wrong — an RPC
 * for one network and a chain id for another, an address with no contract at
 * it — is exactly what a config-only check cannot see.
 */

import type { Address } from 'viem';

// ── Known networks ────────────────────────────────────────────────────────────

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum mainnet',
  8453: 'Base mainnet',
  84532: 'Base Sepolia (testnet)',
  42161: 'Arbitrum One',
  421614: 'Arbitrum Sepolia (testnet)',
};

const TESTNET_CHAIN_IDS = new Set([84532, 421614, 11155111, 80002]);

export function chainName(chainId: number): string {
  return CHAIN_NAMES[chainId] ?? `chain ${chainId}`;
}

export function isTestnet(chainId: number): boolean {
  return TESTNET_CHAIN_IDS.has(chainId);
}

/** True when CHAIN_ID was actually set, rather than falling back to the default. */
export function chainIdWasExplicit(): boolean {
  const raw = process.env['CHAIN_ID'];
  return raw !== undefined && raw.trim() !== '';
}

export class ChainPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainPreflightError';
  }
}

// ── Static checks, safe to run at boot before any network call ────────────────

/**
 * Refuse to start a production deployment that inherited the testnet default.
 *
 * Deliberately not "warn": the whole failure mode here is that nothing looks
 * wrong. A warning in a startup log is indistinguishable from the hundred other
 * lines nobody reads, and the consequence is a lender underwriting against a
 * Sepolia record.
 */
export function assertChainConfigured(): void {
  if (process.env['NODE_ENV'] !== 'production') return;

  // No on-chain bridge configured at all is a supported mode — the bureau runs
  // Mode 1 only. This guards the half-configured case, not the unconfigured one.
  if (!process.env['CHAIN_RPC_URL']) return;

  if (!chainIdWasExplicit()) {
    throw new ChainPreflightError(
      'CHAIN_RPC_URL is set but CHAIN_ID is not. CHAIN_ID defaults to 84532 (Base Sepolia), so ' +
      'this deployment would settle Mode 2 scores to a testnet while reporting them as settled. ' +
      'Set CHAIN_ID explicitly — 8453 for Base mainnet.',
    );
  }

  const chainId = Number(process.env['CHAIN_ID']);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new ChainPreflightError(`CHAIN_ID="${process.env['CHAIN_ID']}" is not a valid chain id.`);
  }

  if (isTestnet(chainId) && process.env['ALLOW_TESTNET_IN_PRODUCTION'] !== 'true') {
    throw new ChainPreflightError(
      `CHAIN_ID=${chainId} is ${chainName(chainId)} and NODE_ENV=production. Mode 2 scores ` +
      'would carry a transaction hash a lender cannot distinguish from a mainnet one. Set ' +
      'ALLOW_TESTNET_IN_PRODUCTION=true to run a production build against a testnet on purpose.',
    );
  }
}

// ── Live checks against the chain ─────────────────────────────────────────────

export interface PreflightReport {
  ok: boolean;
  configuredChainId: number;
  rpcChainId?: number;
  chain: string;
  testnet: boolean;
  settlementAddress?: string;
  nativeBalanceWei?: bigint;
  contracts: { name: string; address: string; hasCode: boolean }[];
  problems: string[];
}

interface PublicClientLike {
  getChainId(): Promise<number>;
  getBytecode(args: { address: Address }): Promise<string | undefined>;
  getBalance(args: { address: Address }): Promise<bigint>;
}

interface ChainClientLike {
  chainId: number;
  address: string;
  publicClient(): PublicClientLike;
}

/**
 * Ask the chain what it is, and compare.
 *
 * Every problem is collected rather than thrown on first sight: an operator
 * fixing a mainnet rollout wants the whole list, not one item per restart.
 */
export async function runChainPreflight(client: ChainClientLike): Promise<PreflightReport> {
  const problems: string[] = [];
  const configuredChainId = client.chainId;
  const pub = client.publicClient();

  const report: PreflightReport = {
    ok: false,
    configuredChainId,
    chain: chainName(configuredChainId),
    testnet: isTestnet(configuredChainId),
    contracts: [],
    problems,
  };

  // 1. The check that matters most: does the RPC agree about which network
  //    this is? A mainnet RPC with a testnet chain id is self-consistent
  //    configuration and completely wrong.
  try {
    const rpcChainId = await pub.getChainId();
    report.rpcChainId = rpcChainId;
    if (rpcChainId !== configuredChainId) {
      problems.push(
        `CHAIN_ID is ${configuredChainId} (${chainName(configuredChainId)}) but CHAIN_RPC_URL ` +
        `is connected to ${rpcChainId} (${chainName(rpcChainId)}). One of them is wrong.`,
      );
    }
  } catch (err) {
    problems.push(`Could not reach CHAIN_RPC_URL: ${err instanceof Error ? err.message : String(err)}`);
    return report;
  }

  // 2. Contract addresses must have code on this network. The same address on
  //    a different chain is usually empty, which is what a testnet address
  //    carried into a mainnet config looks like.
  const targets: [string, string | undefined][] = [
    ['FORGE_REGISTRY_ADDRESS',  process.env['FORGE_REGISTRY_ADDRESS']],
    ['FORGE_VALIDATOR_ADDRESS', process.env['FORGE_VALIDATOR_ADDRESS']],
    ['FORGE_ENFORCER_ADDRESS',  process.env['FORGE_ENFORCER_ADDRESS']],
    ['FORGE_CORE_ADDRESS',      process.env['FORGE_CORE_ADDRESS']],
  ];

  for (const [name, addr] of targets) {
    if (!addr) { problems.push(`${name} is not set.`); continue; }
    try {
      const code = await pub.getBytecode({ address: addr as Address });
      const hasCode = Boolean(code && code !== '0x');
      report.contracts.push({ name, address: addr, hasCode });
      if (!hasCode) {
        problems.push(
          `${name}=${addr} has no contract code on ${chainName(configuredChainId)}. ` +
          'This is what a testnet address looks like in a mainnet configuration.',
        );
      }
    } catch (err) {
      problems.push(`${name}=${addr} could not be read: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. The settlement wallet pays gas for every batch. Empty means Mode 2
  //    silently stops settling — the scheduler keeps running and every run
  //    fails.
  try {
    report.settlementAddress = client.address;
    const balance = await pub.getBalance({ address: client.address as Address });
    report.nativeBalanceWei = balance;
    if (balance === 0n) {
      problems.push(
        `Settlement wallet ${client.address} has no native balance on ` +
        `${chainName(configuredChainId)} and cannot pay gas. Mode 2 settlement will fail on ` +
        'every run.',
      );
    }
  } catch (err) {
    problems.push(`Could not read the settlement wallet balance: ${err instanceof Error ? err.message : String(err)}`);
  }

  report.ok = problems.length === 0;
  return report;
}

/** Render a report for a terminal or a startup log. */
export function formatPreflight(r: PreflightReport): string {
  const lines: string[] = [];
  lines.push('=== Mode 2 chain preflight ===');
  lines.push(`Configured chain : ${r.configuredChainId} (${r.chain})${r.testnet ? '  [TESTNET]' : ''}`);
  if (r.rpcChainId !== undefined) lines.push(`RPC reports      : ${r.rpcChainId} (${chainName(r.rpcChainId)})`);
  if (r.settlementAddress) {
    const bal = r.nativeBalanceWei === undefined ? 'unknown' : `${Number(r.nativeBalanceWei) / 1e18} native`;
    lines.push(`Settlement wallet: ${r.settlementAddress} (${bal})`);
  }
  for (const c of r.contracts) {
    lines.push(`  ${c.hasCode ? '[ok]  ' : '[FAIL]'} ${c.name} ${c.address}`);
  }
  if (r.problems.length === 0) {
    lines.push('All checks passed.');
  } else {
    lines.push('');
    lines.push(`${r.problems.length} problem(s):`);
    for (const p of r.problems) lines.push(`  - ${p}`);
  }
  return lines.join('\n');
}
