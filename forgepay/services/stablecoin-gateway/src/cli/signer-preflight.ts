#!/usr/bin/env node
/**
 * Signer gate. Run before turning the outbound signer on, and again after any
 * change to its configuration.
 *
 * `npm run preflight:signer`
 *
 * Answers four questions a person should never have to guess about a wallet
 * that can move money:
 *
 *   - is a signer configured at all, and on which chain;
 *   - which address will funds actually leave from;
 *   - can it pay gas, and does it hold any USDC;
 *   - how much of the daily ceiling is already spent.
 *
 * Read-only. It broadcasts nothing and costs no gas, so it is safe to run
 * against mainnet before you have decided to go live.
 */

import { ethers } from 'ethers';
import {
  signerRequested, resolveSignerConfig, spentLast24hUsd,
  PayoutSignerConfigError,
} from '../lib/payout-signer.js';
import { PAYOUT_AUTO_APPROVE_MAX_USD, PAYOUT_ABSOLUTE_MAX_USD } from '../lib/payouts.js';

const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];
const USDC_DECIMALS = 6;

async function main(): Promise<void> {
  console.log('');
  console.log('=== Outbound payout signer preflight ===');
  console.log('');

  if (!signerRequested()) {
    console.log('Signer: NOT ENABLED.');
    console.log('');
    console.log('PAYOUT_SIGNER_ENABLED is not exactly "true", so no signer will be installed and');
    console.log('payout submission is refused in production rather than simulated. This is the');
    console.log('safe default — nothing is wrong.');
    console.log('');
    console.log('Note that "1", "yes" and "TRUE" all count as not enabled, deliberately.');
    console.log('');
    process.exit(0);
  }

  let cfg;
  try {
    cfg = resolveSignerConfig();
  } catch (err: unknown) {
    if (err instanceof PayoutSignerConfigError) {
      console.error('[FAIL] ' + err.message);
      console.error('');
      process.exit(1);
    }
    throw err;
  }

  console.log(`Chain           : ${cfg.chain} (chainId ${cfg.chainId})`);
  console.log(`USDC contract   : ${cfg.usdcAddress}`);
  console.log(`Daily ceiling   : $${cfg.dailyMaxUsd}`);
  console.log(`Auto-approve ≤  : $${PAYOUT_AUTO_APPROVE_MAX_USD}`);
  console.log(`Absolute max    : $${PAYOUT_ABSOLUTE_MAX_USD}`);
  console.log(`Confirmations   : ${cfg.confirmations}`);
  console.log('');

  const problems: string[] = [];

  // The key is read here only to derive the address. It is never printed, and
  // a malformed key is reported without echoing any of it.
  const keyFile = process.env['PAYOUT_SIGNER_KEY_FILE'];
  const inlineKey = process.env['PAYOUT_SIGNER_PRIVATE_KEY'];
  if (!keyFile && !inlineKey) {
    console.error('[FAIL] No key configured. Set PAYOUT_SIGNER_KEY_FILE (preferred) or PAYOUT_SIGNER_PRIVATE_KEY.');
    console.error('');
    process.exit(1);
  }
  if (!keyFile && inlineKey) {
    console.log('[warn] Key supplied via PAYOUT_SIGNER_PRIVATE_KEY. On mainnet prefer');
    console.log('       PAYOUT_SIGNER_KEY_FILE — an environment variable is inherited by every');
    console.log('       child process and appears in crash dumps.');
    console.log('');
  }

  let wallet: ethers.Wallet;
  let provider: ethers.JsonRpcProvider;
  try {
    const { readFileSync } = await import('node:fs');
    const key = keyFile ? readFileSync(keyFile, 'utf8').trim() : inlineKey!.trim();
    provider = new ethers.JsonRpcProvider(cfg.rpcUrl, cfg.chainId);
    wallet = new ethers.Wallet(key, provider);
  } catch {
    console.error('[FAIL] The configured signing key could not be loaded or is not a valid private key.');
    console.error('       (Details withheld so the key cannot reach the logs.)');
    console.error('');
    process.exit(1);
  }

  console.log(`Funds leave from: ${wallet.address}`);
  console.log('');

  // Does the RPC agree about which network this is?
  try {
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== cfg.chainId) {
      problems.push(
        `PAYOUT_SIGNER_CHAIN implies chainId ${cfg.chainId} but the RPC reports ` +
        `${net.chainId}. One of them is wrong.`,
      );
    } else {
      console.log(`[ok]   RPC confirms chainId ${cfg.chainId}.`);
    }
  } catch (err) {
    problems.push(`Could not reach PAYOUT_SIGNER_RPC_URL: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Gas.
  try {
    const gas = await provider.getBalance(wallet.address);
    if (gas === 0n) {
      problems.push('Signing wallet has no native balance and cannot pay gas. Fund it before enabling.');
    } else {
      console.log(`[ok]   Native balance: ${ethers.formatEther(gas)}`);
    }
  } catch (err) {
    problems.push(`Could not read native balance: ${err instanceof Error ? err.message : String(err)}`);
  }

  // USDC.
  try {
    const usdc = new ethers.Contract(cfg.usdcAddress, ERC20_BALANCE_ABI, provider);
    const bal = (await usdc['balanceOf']!(wallet.address)) as bigint;
    const human = Number(ethers.formatUnits(bal, USDC_DECIMALS));
    if (bal === 0n) {
      console.log('[warn] USDC balance is 0. The signer will refuse every payout until funded.');
    } else {
      console.log(`[ok]   USDC balance: ${human}`);
      if (human < cfg.dailyMaxUsd) {
        console.log(
          `[note] Balance is below the daily ceiling of $${cfg.dailyMaxUsd}, so the balance is ` +
          'the binding limit today. That is a reasonable posture for a hot wallet.',
        );
      }
    }
  } catch (err) {
    problems.push(`Could not read the USDC balance: ${err instanceof Error ? err.message : String(err)}`);
  }

  // How much of today's ceiling is gone. Needs the database.
  try {
    const spent = await spentLast24hUsd();
    console.log(`[ok]   Spent in trailing 24h: $${spent.toFixed(2)} of $${cfg.dailyMaxUsd}`);
  } catch (err) {
    problems.push(
      'Could not read the payouts ledger to compute the trailing-24h spend: ' +
      `${err instanceof Error ? err.message : String(err)}. The daily ceiling cannot be ` +
      'enforced without it — check the database and that migrations have run.',
    );
  }

  console.log('');
  if (problems.length > 0) {
    console.error(`Preflight FAILED with ${problems.length} problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error('');
    process.exit(1);
  }

  console.log('Signer preflight passed. This service can move USDC once payouts are approved.');
  if (!/sepolia|testnet/i.test(cfg.chain)) {
    console.log('');
    console.log('This is a MAINNET configuration. Keep PAYOUT_SIGNER_DAILY_MAX_USD low until you');
    console.log('have watched a full settlement period run correctly.');
  }
  console.log('');
}

main().catch((err) => {
  console.error('');
  console.error('[FAIL] Signer preflight could not complete:', err instanceof Error ? err.message : err);
  console.error('');
  process.exit(1);
});
