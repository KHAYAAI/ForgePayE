#!/usr/bin/env node
/**
 * Pre-deployment gate. Run this before pointing the bureau at a new chain, and
 * again before turning on a live signer.
 *
 * `npm run preflight`
 *
 * Reads configuration, then interrogates the chain itself and reports what is
 * actually true. Exits non-zero on any problem so it can gate a pipeline as
 * well as inform a person.
 *
 * It is read-only: no broadcast, no state change, no gas. Safe to run against
 * mainnet at any time, including before you have decided to deploy.
 */

import {
  assertChainConfigured, runChainPreflight, formatPreflight,
  chainName, isTestnet, ChainPreflightError,
} from '../chain-preflight';
import { getChainClient } from '../chain';

async function main(): Promise<void> {
  console.log('');

  // 1. Static configuration checks. These are the ones that catch a mainnet
  //    rollout still carrying the Base Sepolia default.
  try {
    assertChainConfigured();
    console.log('[ok]   Chain configuration is explicit and consistent with NODE_ENV.');
  } catch (err) {
    if (err instanceof ChainPreflightError) {
      console.error('[FAIL] ' + err.message);
      console.error('');
      process.exit(1);
    }
    throw err;
  }

  // 2. Is the chain bridge configured at all? Running Mode 1 only is a
  //    supported mode, not a failure — say so rather than implying a problem.
  const client = getChainClient();
  if (!client) {
    console.log('');
    console.log('No chain bridge configured — the bureau will run Mode 1 (off-chain scoring) only.');
    console.log('Mode 2 scores will be null and nothing will settle on-chain.');
    console.log('');
    console.log('To enable it, set CHAIN_RPC_URL, CHAIN_ID, SETTLEMENT_PRIVATE_KEY and the five');
    console.log('FORGE_*_ADDRESS variables, then run this again.');
    console.log('');
    process.exit(0);
  }

  // 3. Live checks against the chain.
  const report = await runChainPreflight(client);
  console.log('');
  console.log(formatPreflight(report));
  console.log('');

  if (!report.ok) {
    console.error(`Preflight FAILED with ${report.problems.length} problem(s). Do not deploy.`);
    console.error('');
    process.exit(1);
  }

  // A passing testnet preflight is a pass, but it should not be mistaken for
  // readiness to take real money.
  if (isTestnet(report.configuredChainId)) {
    console.log(
      `Preflight passed against ${chainName(report.configuredChainId)}. This is a testnet — ` +
      'scores settled here carry a transaction hash that means nothing to a lender.',
    );
  } else {
    console.log(`Preflight passed against ${chainName(report.configuredChainId)}.`);
  }
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('[FAIL] Preflight could not complete:', err instanceof Error ? err.message : err);
  console.error('');
  process.exit(1);
});
