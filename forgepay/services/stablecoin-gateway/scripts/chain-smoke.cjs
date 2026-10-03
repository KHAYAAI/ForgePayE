#!/usr/bin/env node
/**
 * One end-to-end pass on a REAL chain with tiny amounts: the first-contact procedure (docs/launch/03) as a script.
 * Run it from a machine with RPC access (the build sandbox has none). Testnet first; mainnet only with the explicit
 * acknowledgement below. USDC only: ZARP and OUSD are on hold.
 *
 *   SMOKE_RPC_URL=https://sepolia.base.org SMOKE_CHAIN_ID=84532 SMOKE_USDC=0x<usdc on that chain> \
 *   SMOKE_PAYER_KEY_FILE=~/.smoke/payer.key SMOKE_SIGNER_KEY_FILE=~/.smoke/payout.key SMOKE_GAS_KEY_FILE=~/.smoke/gas.key \
 *   SMOKE_TREASURY=0x<address you control> node scripts/chain-smoke.cjs
 *
 * Wallets (generate them yourself, offline; keys are read from FILES, never printed, never passed on a command line):
 *   payer   holds the test USDC and some ETH; pays the deposit
 *   signer  the payout wallet: needs ETH for gas and at least SMOKE_AMOUNT_USD of USDC (fund it from the payer first)
 *   gas     the sweep gas wallet: needs a little ETH
 * SMOKE_TREASURY receives the sweep. SMOKE_AMOUNT_USD defaults to 1.
 *
 * It checks, in order: the token is what we think it is (symbol, decimals, chain id); a deposit confirms for exactly the
 * amount paid and the address holds it; the sweep moves exactly that to the treasury; a payout reaches a fresh address
 * for exactly its amount (human approval step included); reconciliation finds nothing wrong. It leaves its database and a
 * generated deposit-key encryption key in .smoke/<time>/ (mode 0600) so funds in a deposit address can be swept later if a
 * run stops half way. NOT a production-configuration test: the gateway runs in development mode with a throwaway
 * database; the real deployment exercises the production settings.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const GW = path.resolve(__dirname, '..');
const { ethers } = require(require.resolve('ethers', { paths: [GW] }));
const { Pool } = require(require.resolve('pg', { paths: [GW] }));

const need = (k) => { const v = process.env[k]; if (!v) { console.error(`${k} is required (see the header of this file)`); process.exit(2); } return v; };
const keyFrom = (k) => { const f = need(k).replace(/^~/, process.env.HOME || ''); const raw = fs.readFileSync(f, 'utf8').trim(); return raw.startsWith('0x') ? raw : '0x' + raw; };

const RPC = need('SMOKE_RPC_URL'), CHAIN_ID = Number(need('SMOKE_CHAIN_ID')), USDC = ethers.getAddress(need('SMOKE_USDC'));
const TREASURY = ethers.getAddress(need('SMOKE_TREASURY'));
const AMOUNT_USD = Number(process.env.SMOKE_AMOUNT_USD || 1);
const MAINNET_IDS = new Set([1, 8453, 137, 42161]);
if (MAINNET_IDS.has(CHAIN_ID)) {
  if (process.env.SMOKE_I_UNDERSTAND_THIS_USES_REAL_MONEY !== 'yes') { console.error(`chain ${CHAIN_ID} is a MAINNET: this spends real money. Set SMOKE_I_UNDERSTAND_THIS_USES_REAL_MONEY=yes to continue.`); process.exit(2); }
  if (AMOUNT_USD > 5) { console.error('on a mainnet the smoke amount is capped at 5 USD'); process.exit(2); }
}
if (!(AMOUNT_USD > 0)) { console.error('SMOKE_AMOUNT_USD must be positive'); process.exit(2); }

const PORT = Number(process.env.SMOKE_PORT || 8023), BASE = `http://127.0.0.1:${PORT}`;
const PG = { host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || 'forgepay', password: process.env.PGPASSWORD || '' };
const DB = `forgepay_smoke_${Date.now()}`;
const RUN = path.join(GW, '.smoke', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(RUN, { recursive: true, mode: 0o700 });
const WRAP_KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(RUN, 'PRIVATE_KEY_ENCRYPTION_KEY'), WRAP_KEY + '\n', { mode: 0o600 });

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, every = 3000) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }
const H = { 'content-type': 'application/json', authorization: 'Bearer smoke-admin', 'x-forge-service': 'smoke' };
async function api(method, p, body) { const r = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: ethers.Network.from(CHAIN_ID), cacheTimeout: -1 });
  const payer = new ethers.Wallet(keyFrom('SMOKE_PAYER_KEY_FILE'), provider);
  const signerKey = keyFrom('SMOKE_SIGNER_KEY_FILE'), signerAddr = new ethers.Wallet(signerKey).address;
  const gasAddr = new ethers.Wallet(keyFrom('SMOKE_GAS_KEY_FILE')).address;
  const erc20 = new ethers.Contract(USDC, ['function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'], provider);
  console.log(`chain ${CHAIN_ID} via ${new URL(RPC).host}; USDC ${USDC}; amount $${AMOUNT_USD}; run files in ${RUN}`);

  console.log('0. The chain and the token are what we think they are');
  const net = await provider.getNetwork();
  if (!check('the RPC reports the chain id we asked for', Number(net.chainId) === CHAIN_ID, `got ${net.chainId}`)) process.exit(1);
  const sym = await erc20.symbol(), dec = Number(await erc20.decimals());
  if (!check('the contract calls itself USDC with 6 decimals', sym === 'USDC' && dec === 6, `${sym}, ${dec} decimals`)) process.exit(1);
  const units = ethers.parseUnits(String(AMOUNT_USD), 6);
  const payerUsdc = await erc20.balanceOf(payer.address), signerUsdc = await erc20.balanceOf(signerAddr);
  const eth = async (a) => provider.getBalance(a);
  check('the payer holds enough USDC and some ETH', payerUsdc >= units && (await eth(payer.address)) > 0n, `${ethers.formatUnits(payerUsdc, 6)} USDC`);
  check('the payout wallet holds enough USDC and ETH for the payout', signerUsdc >= units && (await eth(signerAddr)) > 0n, `${ethers.formatUnits(signerUsdc, 6)} USDC`);
  check('the gas wallet holds some ETH', (await eth(gasAddr)) > 0n);
  if (fail) { console.error('\nfund the wallets first (see the header), then run again'); process.exit(1); }

  const admin = new Pool({ ...PG, database: 'postgres' });
  await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  fs.writeFileSync(path.join(RUN, 'DATABASE'), DB + '\n');
  const db = new Pool({ ...PG, database: DB });
  const log = fs.openSync(path.join(RUN, 'gateway.log'), 'w');
  const gw = spawn(path.join(GW, 'node_modules/.bin/tsx'), ['src/index.ts'], {
    cwd: GW, stdio: ['ignore', log, log],
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(PORT), POSTGRES_HOST: PG.host, POSTGRES_DB: DB, POSTGRES_USER: PG.user, POSTGRES_PASSWORD: PG.password || 'x',
      INTERNAL_WEBHOOK_SECRET: 'smoke', BASE_RPC_URL: RPC, BASE_CHAIN_ID: String(CHAIN_ID), BASE_CONFIRMATIONS: '3', DEPOSIT_MONITOR_CHAINS: 'base',
      SETTLEMENT_INTERVAL_MS: '4000', ASSET_VERIFY_INTERVAL_MS: '600000', ASSETS_ENABLED: 'USDC', ASSET_USDC_BASE: USDC,
      ASSET_USDC_ETHEREUM: 'off', ASSET_USDC_POLYGON: 'off', ASSET_USDC_ARBITRUM: 'off',
      PRIVATE_KEY_ENCRYPTION_KEY: WRAP_KEY, LEADER_LOCK_ENABLED: 'false',
      PAYOUT_SIGNER_ENABLED: 'true', PAYOUT_SIGNER_CHAIN: 'base', PAYOUT_SIGNER_CHAIN_ID: String(CHAIN_ID), PAYOUT_SIGNER_RPC_URL: RPC, PAYOUT_SIGNER_KEY_FILE: need('SMOKE_SIGNER_KEY_FILE').replace(/^~/, process.env.HOME || ''),
      PAYOUT_SIGNER_DAILY_MAX_USD: '50', PAYOUT_SIGNER_CONFIRMATIONS: '2', PAYOUT_AUTO_SUBMIT: 'false', PAYOUT_AUTO_APPROVE_MAX_USD: '0', PAYOUT_ABSOLUTE_MAX_USD: '50',
      SWEEP_ENABLED: 'true', SWEEP_TREASURY_ADDRESS: TREASURY, SWEEP_GAS_KEY_FILE: need('SMOKE_GAS_KEY_FILE').replace(/^~/, process.env.HOME || ''), SWEEP_INTERVAL_MS: '5000', SWEEP_MIN_USD: '0.5', SWEEP_MAX_GAS_GWEI: '100',
      [`SWEEP_CHAIN_ID_BASE`]: String(CHAIN_ID),
    },
  });
  const stop = () => { try { gw.kill('SIGTERM'); } catch {} };
  process.on('exit', stop);
  try {
    for (let i = 0; i < 120; i++) { if (await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false)) break; await sleep(500); }
    console.log('1. The gateway sees the asset');
    const assets = (await api('GET', '/assets')).body;
    const st = assets?.assets?.find((a) => a.symbol === 'USDC' && a.chain === 'base');
    check('USDC is available on the chain, verified from the contract', st?.status === 'available', JSON.stringify(st ?? assets).slice(0, 200));
    check('every finding the probes made is shown (read them)', true, JSON.stringify(st?.findings ?? []));

    const treasuryBefore = await erc20.balanceOf(TREASURY); // before anything is paid: the sweep can finish quickly
    console.log('2. Inbound: a deposit');
    const dep = (await api('POST', '/deposits', { merchant_id: 'smoke', amount_usd: AMOUNT_USD, token: 'USDC', chain: 'base' })).body;
    check('a deposit opened for the exact amount', dep?.amount_units === units.toString(), JSON.stringify({ units: dep?.amount_units, to: dep?.address }));
    const tx = await erc20.connect(payer).transfer(dep.address, units);
    console.log(`  paid: ${tx.hash}`);
    await tx.wait(1);
    const confirmed = await waitFor(async () => (await db.query(`SELECT * FROM stablecoin_deposits WHERE id=$1 AND status='confirmed'`, [dep.id])).rows[0], 20 * 60_000);
    check('the deposit was confirmed', !!confirmed);
    check('credited exactly what was paid', confirmed?.received_amount_units === units.toString());
    check('the deposit address holds exactly that', (await erc20.balanceOf(dep.address)) === units || (await db.query(`SELECT 1 FROM deposit_sweeps WHERE deposit_id=$1`, [dep.id])).rows.length > 0, 'or it has already been swept');

    console.log('3. The sweep to the treasury');
    const swept = await waitFor(async () => (await db.query(`SELECT * FROM deposit_sweeps WHERE deposit_id=$1 AND status='swept'`, [dep.id])).rows[0], 15 * 60_000);
    check('the deposit was swept', !!swept, swept ? swept.sweep_tx : 'check .smoke gateway.log: gas wallet funded? gas above the ceiling?');
    if (swept) {
      await sleep(5000);
      const gained = (await erc20.balanceOf(TREASURY)) - treasuryBefore;
      check('the treasury received exactly the amount paid (a fee-on-transfer token would show here)', gained === units, `${ethers.formatUnits(gained, 6)} USDC`);
      check('the deposit address was left empty of USDC', (await erc20.balanceOf(dep.address)) === 0n);
    }

    console.log('4. Outbound: a payout, with a person approving it');
    const payee = ethers.Wallet.createRandom().address;
    const pay = (await api('POST', '/payouts', { external_id: `smoke-${Date.now()}`, payee_id: 'smoke', payee_address: payee, amount_usd: AMOUNT_USD, asset: 'USDC', reason: 'smoke test' })).body;
    check('the payout was recorded and is waiting for approval', pay?.data?.status === 'pending_approval', pay?.data?.status);
    const approve = await api('POST', `/payouts/${pay.data.id}/approve`, { approved_by: 'smoke-approver' });
    check('approved by someone other than the requester', approve.status === 200 && approve.body?.data?.status === 'approved');
    const sub = await api('POST', `/payouts/${pay.data.id}/submit`, {});
    check('submitted and confirmed on-chain', sub.status === 200 && sub.body?.data?.status === 'confirmed', JSON.stringify(sub.body).slice(0, 200));
    await sleep(5000);
    check('the new address received exactly the amount', (await erc20.balanceOf(payee)) === units, `${ethers.formatUnits(await erc20.balanceOf(payee), 6)} USDC`);

    console.log('5. Reconciliation');
    const rec = (await api('POST', '/reconcile/run', {})).body?.report;
    check('the ledger matches the chain for everything just done', rec?.clean === true && rec.examined.sweeps >= 1 && rec.examined.payouts >= 1, JSON.stringify({ examined: rec?.examined, findings: rec?.findings, errors: rec?.errors }).slice(0, 300));
  } finally {
    stop();
    await db.end().catch(() => {});
  }
  console.log(`\n${pass}/${pass + fail} passed. Files, including the deposit-key encryption key, are in ${RUN}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SCRIPT FAILED:', e.message); process.exit(1); });
