#!/usr/bin/env node
/**
 * Custody signer gate. Run before turning custody payouts on, and again after any change to their configuration.
 *
 * `npm run preflight:custody`
 *
 * Answers what a person should never have to guess about a service that can ask custody to move money:
 *
 *   - is custody mode configured, and are the URL, chain, agent key and our own ceilings valid;
 *   - does custody accept the agent key, and when does it expire;
 *   - may the key pay the token on our chain, and can custody broadcast there;
 *   - how much of our own daily ceiling is already spent.
 *
 * Read-only. It asks custody to describe the key and the tokens and pays nothing, so it is safe to run against any environment.
 */

import {
  CustodyConfigError, checkCustodyReadiness, custodyModeRequested, readAgentKey, resolveCustodyConfig,
} from '../lib/custody-payout-signer.js';
import { spentLast24hUsd } from '../lib/payout-signer.js';

async function main(): Promise<void> {
  console.log('');
  console.log('=== Custody payout signer preflight ===');
  console.log('');

  if (!custodyModeRequested()) {
    console.log('Custody signer: NOT ENABLED.');
    console.log('');
    console.log('It needs PAYOUT_SIGNER_ENABLED=true and PAYOUT_SIGNER_MODE=custody, both exactly. Anything else leaves outbound');
    console.log('payouts as they are (refused in production unless the hot-wallet signer is configured). Nothing is wrong.');
    console.log('');
    process.exit(0);
  }

  let cfg; let key;
  try {
    cfg = resolveCustodyConfig();
    key = readAgentKey();
  } catch (err: unknown) {
    if (err instanceof CustodyConfigError) {
      console.error('[FAIL] ' + err.message);
      console.error('');
      process.exit(1);
    }
    throw err;
  }

  console.log(`Custody API     : ${cfg.baseUrl}`);
  console.log(`Chain           : ${cfg.chain} (chainId ${cfg.chainId})`);
  console.log(`Confirmations   : ${cfg.confirmations}`);
  console.log('');

  const r = await checkCustodyReadiness(cfg, key);
  for (const line of r.info) console.log(line);
  try {
    const spent = await spentLast24hUsd();
    console.log(`Spent last 24h  : $${spent.toFixed(2)} of $${cfg.dailyMaxUsd} (our ceiling)`);
  } catch {
    console.log('Spent last 24h  : unavailable (no database configured for this check)');
  }
  console.log('');

  if (!r.ok) {
    for (const p of r.problems) console.error('[FAIL] ' + p);
    console.error('');
    console.error('Not ready. Fix the above before enabling custody payouts.');
    console.error('');
    process.exit(1);
  }
  console.log('Ready. Custody accepts the key and can pay the token on this chain. Nothing was paid by this check.');
  console.log('');
}

main().catch((err) => {
  console.error('[FAIL] preflight crashed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
