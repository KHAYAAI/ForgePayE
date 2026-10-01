#!/usr/bin/env node
/**
 * Multi-asset end-to-end: the real gateway (tsx), a real Postgres, and real ERC-20
 * contracts on a local chain standing in for USDC, ZARP and OUSD. Verifies quoting,
 * x402 top-ups, settlement (partial, late, wrong-token, restart), and outbound
 * payouts in each asset.
 *
 * Needs: Postgres reachable with the env below, and ganache (chain 1337) on :8545.
 *   GW_DIR      stablecoin-gateway directory (default: this script's parent)
 *   PGHOST/PGUSER/PGPASSWORD, RPC_URL, FUNDER_MNEMONIC
 */
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const GW = process.env.GW_DIR || path.resolve(__dirname, '..');
const { ethers } = require(require.resolve('ethers', { paths: [GW] }));
const { Pool } = require(require.resolve('pg', { paths: [GW] }));

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const PORT = Number(process.env.GW_PORT || 8021);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = process.env.E2E_DB || 'forgepay_sgw_e2e';
const PG = { host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || 'forgepay', password: process.env.PGPASSWORD || 'devpassword' };
const MNEMONIC = process.env.FUNDER_MNEMONIC || 'test test test test test test test test test test test junk';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 30000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(every); } }

const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: ethers.Network.from(1337), cacheTimeout: -1 });
const funder = ethers.HDNodeWallet.fromPhrase(MNEMONIC).connect(provider);
const fixture = JSON.parse(fs.readFileSync(path.join(GW, 'tests/fixtures/MockToken.json'), 'utf8'));
const mine = async (n = 1) => { for (let i = 0; i < n; i++) await provider.send('evm_mine', []); };

async function deploy(symbol, decimals) {
  const f = new ethers.ContractFactory(fixture.abi, fixture.bytecode, funder);
  const c = await f.deploy(symbol, decimals);
  await c.waitForDeployment();
  return c;
}

let gw = null;
async function startGateway(extraEnv = {}) {
  gw = spawn(path.join(GW, 'node_modules/.bin/tsx'), ['src/index.ts'], {
    cwd: GW, stdio: ['ignore', fs.openSync(`${GW}/.e2e-gateway.log`, 'a'), fs.openSync(`${GW}/.e2e-gateway.log`, 'a')],
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(PORT),
      POSTGRES_HOST: PG.host, POSTGRES_DB: DB, POSTGRES_USER: PG.user, POSTGRES_PASSWORD: PG.password, INTERNAL_WEBHOOK_SECRET: 'e2e',
      BASE_RPC_URL: RPC, BASE_CHAIN_ID: '1337', BASE_CONFIRMATIONS: '2', DEPOSIT_MONITOR_CHAINS: 'base',
      SETTLEMENT_INTERVAL_MS: '700', SETTLEMENT_EXPIRY_GRACE_MS: '4000', SETTLEMENT_LATE_SCAN_EVERY: '3', ASSET_VERIFY_INTERVAL_MS: '600000',
      ASSET_USDC_ETHEREUM: 'off', ASSET_USDC_POLYGON: 'off', ASSET_USDC_ARBITRUM: 'off',
      ASSET_USDT_ETHEREUM: 'off', ASSET_USDT_POLYGON: 'off', ASSET_USDT_ARBITRUM: 'off',
      PAYOUT_SIGNER_ENABLED: 'true', PAYOUT_SIGNER_CHAIN: 'base', PAYOUT_SIGNER_CHAIN_ID: '1337', PAYOUT_SIGNER_RPC_URL: RPC,
      PAYOUT_SIGNER_DAILY_MAX_USD: '1000000', PAYOUT_SIGNER_PRIVATE_KEY: signer.privateKey, PAYOUT_SIGNER_CONFIRMATIONS: '1',
      PAYOUT_AUTO_SUBMIT: 'false', PAYOUT_WORKER_INTERVAL_MS: '700', PAYOUT_STALE_AFTER_MS: '5000', SWEEP_INTERVAL_MS: '1000',
      ...(process.env.E2E_KEY_WRAP === 'vault' ? { KEY_WRAP_PROVIDER: 'vault', VAULT_ADDR: process.env.VAULT_ADDR, VAULT_TOKEN: process.env.VAULT_TOKEN, KEY_WRAP_VAULT_KEY: 'e2e-deposit-keys' } : {}),
      PAYOUT_AUTO_APPROVE_MAX_USD: '100', PAYOUT_ABSOLUTE_MAX_USD: '25000', X402_MAX_AMOUNT_USDC: '1000',
      ...tokenEnv, ...extraEnv,
    },
  });
  const up = await waitFor(async () => (await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false)), 60000);
  if (!up) throw new Error('gateway did not start; see ' + GW + '/.e2e-gateway.log');
}
async function stopGateway() {
  if (!gw) return;
  gw.kill('SIGTERM');
  await waitFor(async () => gw.exitCode !== null || gw.signalCode !== null, 8000);
  gw = null;
}
const H = { 'content-type': 'application/json', authorization: 'Bearer e2e-admin', 'x-forge-service': 'e2e-bureau' };
async function api(method, p, body) {
  const r = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const signer = ethers.Wallet.createRandom();
let tokenEnv = {};
let tokens = {};
let db;

(async () => {
  console.log('Setup: fresh database (migrations must stand alone), three real token contracts');
  const admin = new Pool({ ...PG, database: 'postgres' });
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  db = new Pool({ ...PG, database: DB });
  tokens = { USDC: await deploy('USDC', 6), ZARP: await deploy('ZARP', 18), OUSD: await deploy('OUSD', 6) };
  const addr = Object.fromEntries(await Promise.all(Object.entries(tokens).map(async ([k, c]) => [k, await c.getAddress()])));
  tokenEnv = { ASSET_USDC_BASE: addr.USDC, ASSET_ZARP_BASE: addr.ZARP, ASSET_OUSD_BASE: addr.OUSD };
  console.log('  tokens:', JSON.stringify(addr));
  await (await funder.sendTransaction({ to: signer.address, value: ethers.parseEther('5') })).wait();
  for (const k of Object.keys(tokens)) {
    const d = await tokens[k].decimals();
    await (await tokens[k].mint(signer.address, ethers.parseUnits('100000', d))).wait(); // the payout wallet
    await (await tokens[k].mint(funder.address, ethers.parseUnits('1000000000', d))).wait(); // the "payer"
  }

  await startGateway();
  const units = async (sym) => Number(await tokens[sym].decimals());
  const pay = (sym, to, amount) => tokens[sym].connect(funder).transfer(to, amount).then((t) => t.wait());
  const depositRow = async (id) => (await db.query(`SELECT * FROM stablecoin_deposits WHERE id=$1`, [id])).rows[0];
  const verify = async (id) => (await api('GET', `/x402/verify/${id}`)).body;
  const settle = async (id, want, ms = 25000) => waitFor(async () => { const v = await verify(id); return v.status === want ? v : null; }, ms);

  console.log('1. The assets, read from the chain');
  let a = (await api('GET', '/assets')).body;
  const st = (sym) => a.assets.find((x) => x.symbol === sym && x.chain === 'base');
  check('migrations ran on an empty database and the gateway is up', (await db.query(`SELECT count(*)::int n FROM x402_payments`)).rows[0].n === 0);
  check('USDC is available with 6 decimals', st('USDC')?.status === 'available' && st('USDC').decimals === 6);
  check('ZARP is available with 18 decimals, read from the contract', st('ZARP')?.status === 'available' && st('ZARP').decimals === 18, JSON.stringify(st('ZARP')));
  check('OUSD is available with 6 decimals, read from the contract', st('OUSD')?.status === 'available' && st('OUSD').decimals === 6);
  check('ZARP is not quotable yet: there is no rand rate', st('ZARP').quotable === false && a.rates['USD/ZAR'].fresh === false);

  console.log('2. The rand rate is an operator decision, and safeguarded');
  const noRate = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:r1', merchant_id: 'forgepay-credit-bureau', amount_usd: 10, asset: 'ZARP' });
  check('paying in ZARP without a rate is refused, not guessed', noRate.status === 503 && noRate.body?.error === 'RateUnavailable', noRate.status + ' ' + JSON.stringify(noRate.body).slice(0,300));
  check('a rate with no source is refused', (await api('PUT', '/assets/rates/USD-ZAR', { rate: 18.5 })).status === 400);
  check('an implausible rate is refused', (await api('PUT', '/assets/rates/USD-ZAR', { rate: 1850, source: 'typo' })).status === 400);
  check('a proper rate is accepted', (await api('PUT', '/assets/rates/USD-ZAR', { rate: 18.5, source: 'ops desk' })).status === 201);
  check('a jump of over 25% needs explicit confirmation', (await api('PUT', '/assets/rates/USD-ZAR', { rate: 26, source: 'ops desk' })).status === 409);
  a = (await api('GET', '/assets')).body;
  check('ZARP is now quotable, at 18.5', st('ZARP').quotable === true && a.rates['USD/ZAR'].rate === '18.5');

  console.log('3. A ZARP top-up, end to end');
  const z = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req1', merchant_id: 'forgepay-credit-bureau', agent_id: 'req1', amount_usd: 10, asset: 'ZARP' });
  check('the bureau\'s string merchant id is accepted (it used to be rejected as a UUID)', z.status === 201, JSON.stringify(z.body).slice(0, 200));
  check('$10 at R18.5 is 185 ZARP, exactly, in 18-decimal units', z.body.amount_asset === '185' && z.body.amount_units === (185n * 10n ** 18n).toString());
  check('it names a one-time address to pay, the token contract and the locked rate', /^0x[0-9a-fA-F]{40}$/.test(z.body.pay_to) && z.body.asset.contract === addr.ZARP && z.body.fx.rate === '18.5', JSON.stringify(z.body).slice(0,500));
  check('the deposit behind it exists (the foreign key that used to fail)', !!(await depositRow(z.body.deposit_id)));
  check('it is not valid before it is paid', (await verify(z.body.receipt_id)).valid === false);
  await pay('ZARP', z.body.pay_to, BigInt(z.body.amount_units));
  const seen = await waitFor(async () => (await depositRow(z.body.deposit_id)).status === 'confirming', 15000);
  check('the transfer is seen but not yet final (2 confirmations needed)', !!seen && (await verify(z.body.receipt_id)).valid === false);
  await mine(3);
  const done = await settle(z.body.receipt_id, 'confirmed');
  check('once final, the receipt is confirmed and valid', !!done && done.valid === true, done && `tx ${String(done.tx_hash).slice(0, 12)}…`);
  check('it records exactly what arrived', done.received_units === z.body.amount_units);
  check('and it stays valid after its 5-minute payment window', (await db.query(`UPDATE x402_payments SET expires_at = now() - interval '1 hour' WHERE id=$1`, [z.body.receipt_id])) && (await verify(z.body.receipt_id)).valid === true);

  console.log('4. Partial, over-, wrong-token and late payments');
  const o = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req2', merchant_id: 'forgepay-credit-bureau', amount_usd: 10, asset: 'OUSD' });
  check('$10 in OUSD (6 decimals) is 10 OUSD', o.body.amount_units === '10000000' && o.body.fx.rate === '1');
  await pay('OUSD', o.body.pay_to, 9_000_000n); await mine(3);
  await waitFor(async () => (await depositRow(o.body.deposit_id)).received_amount_units === '9000000', 15000);
  let row = await depositRow(o.body.deposit_id);
  check('9 of 10 OUSD is recorded as a partial payment and is NOT a confirmation', row.status === 'pending' && row.received_amount_units === '9000000' && (await verify(o.body.receipt_id)).valid === false);
  await pay('OUSD', o.body.pay_to, 1_000_000n); await mine(3);
  check('the remaining 1 OUSD completes it (amounts add up)', !!(await settle(o.body.receipt_id, 'confirmed')));

  const w = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req3', merchant_id: 'forgepay-credit-bureau', amount_usd: 5, asset: 'USDC' });
  await pay('ZARP', w.body.pay_to, 10n ** 24n); await pay('OUSD', w.body.pay_to, 50_000_000n); await mine(3);
  await sleep(3000);
  check('ZARP or OUSD sent to a USDC payment does not satisfy it', (await depositRow(w.body.deposit_id)).status === 'pending');
  await pay('USDC', w.body.pay_to, 6_000_000n); await mine(3);
  const over = await settle(w.body.receipt_id, 'confirmed');
  check('an overpayment in the right token confirms, recording what arrived', !!over && over.received_units === '6000000');

  // Arrives just after expiry but inside the grace period: seen while the deposit is still open.
  const late = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req4', merchant_id: 'forgepay-credit-bureau', amount_usd: 5, asset: 'OUSD' });
  await db.query(`UPDATE stablecoin_deposits SET expires_at = now() - interval '300 milliseconds' WHERE id=$1`, [late.body.deposit_id]);
  await sleep(400);
  await pay('OUSD', late.body.pay_to, 5_000_000n); await mine(3);
  const exp = await settle(late.body.receipt_id, 'expired');
  check('a payment that lands after expiry is never credited', !!exp && exp.valid === false);
  row = await waitFor(async () => { const r = await depositRow(late.body.deposit_id); return r.late_units ? r : null; }, 12000);
  check('but is recorded as late, for reconciliation', row?.late_units === '5000000', `late_units=${row?.late_units}`);
  // Arrives long after the deposit expired and stopped being settled: found by the late scan.
  const late2 = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req4b', merchant_id: 'forgepay-credit-bureau', amount_usd: 5, asset: 'OUSD' });
  await db.query(`UPDATE stablecoin_deposits SET expires_at = now() - interval '5 seconds' WHERE id=$1`, [late2.body.deposit_id]);
  await settle(late2.body.receipt_id, 'expired');
  await pay('OUSD', late2.body.pay_to, 5_000_000n); await mine(3);
  row = await waitFor(async () => { const r = await depositRow(late2.body.deposit_id); return r.late_units ? r : null; }, 20000);
  check('a payment to an address that already expired is still found, and never credited', row?.late_units === '5000000' && (await verify(late2.body.receipt_id)).valid === false, `late_units=${row?.late_units}`);
  const idle = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req5', merchant_id: 'forgepay-credit-bureau', amount_usd: 5, asset: 'USDC' });
  await db.query(`UPDATE stablecoin_deposits SET expires_at = now() - interval '5 seconds' WHERE id=$1`, [idle.body.deposit_id]);
  check('an unpaid payment simply expires', !!(await settle(idle.body.receipt_id, 'expired')));

  console.log('5. Settlement survives a restart');
  const rs = await api('POST', '/x402/pay', { resource_url: 'bureau:topup:req6', merchant_id: 'forgepay-credit-bureau', amount_usd: 20, asset: 'ZARP' });
  await stopGateway();
  await pay('ZARP', rs.body.pay_to, BigInt(rs.body.amount_units)); await mine(3);
  await startGateway();
  check('a payment made while the gateway was down is found and confirmed after it restarts', !!(await settle(rs.body.receipt_id, 'confirmed')));

  console.log('6. Older callers keep working');
  const legacy = await api('POST', '/x402/pay', { resource_url: 'r', merchant_id: 'm1', amount_usdc: 2 });
  check('amount_usdc with no asset is a USDC payment', legacy.status === 201 && legacy.body.token === 'USDC' && legacy.body.amount_units === '2000000' && legacy.body.amount_usdc === 2);
  const dep = await api('POST', '/deposits', { merchant_id: 'm1', amount_usd: 3, token: 'ZARP', chain: 'base' });
  check('POST /deposits can take ZARP too', dep.status === 201 && dep.body.decimals === 18 && dep.body.amount_asset === '55.5', JSON.stringify(dep.body).slice(0, 160));
  const pr = await fetch(`${BASE}/x402/payment-required?amount=10`, { headers: H });
  const prb = await pr.json();
  check('the 402 challenge lists every asset with its price in that asset', pr.status === 402 && ['USDC', 'ZARP', 'OUSD'].every((s) => prb.accepts.some((x) => x.extra.symbol === s)) && prb.accepts.find((x) => x.extra.symbol === 'ZARP').extra.amountAsset === '185');

  console.log('7. Outbound payouts in each asset');
  const payee = ethers.Wallet.createRandom().address;
  const p1 = await api('POST', '/payouts', { external_id: 'e2e-z1', payee_id: 'contrib-1', payee_address: payee, chain: 'base', amount_usd: 50, asset: 'ZARP', reason: 'furnisher share' });
  check('a $50 ZARP payout is recorded with its units and locked rate', p1.status === 201 && p1.body.data.asset === 'ZARP' && p1.body.data.amountUnits === (925n * 10n ** 18n).toString() && p1.body.data.fxRate === '18.5', JSON.stringify(p1.body.data));
  check('it needs no approval (under the USD threshold)', p1.body.requires_approval === false && p1.body.data.status === 'approved');
  const sub = await api('POST', `/payouts/${p1.body.data.id}/submit`, {});
  check('submitting sends it', sub.status === 200 && sub.body.data.status === 'confirmed', JSON.stringify(sub.body).slice(0, 200));
  check('the payee received exactly 925 ZARP on-chain', (await tokens.ZARP.balanceOf(payee)) === 925n * 10n ** 18n);
  await api('PUT', '/assets/rates/USD-ZAR', { rate: 19, source: 'ops desk' });
  const p1again = await api('POST', '/payouts', { external_id: 'e2e-z1', payee_id: 'contrib-1', payee_address: payee, chain: 'base', amount_usd: 50, asset: 'ZARP', reason: 'furnisher share' });
  check('a retry after the rate moved returns the original payout at the original rate, sending nothing more', p1again.status === 200 && p1again.body.deduplicated === true && p1again.body.data.amountUnits === p1.body.data.amountUnits && p1again.body.data.fxRate === '18.5');
  const payee2 = ethers.Wallet.createRandom().address;
  const p2 = await api('POST', '/payouts', { external_id: 'e2e-o1', payee_id: 'contrib-2', payee_address: payee2, chain: 'base', amount_usd: 40, asset: 'OUSD', reason: 'share' });
  await api('POST', `/payouts/${p2.body.data.id}/submit`, {});
  check('an OUSD payout sends exactly 40 OUSD (6 decimals)', (await tokens.OUSD.balanceOf(payee2)) === 40_000_000n);
  const p3 = await api('POST', '/payouts', { external_id: 'e2e-u1', payee_id: 'contrib-3', payee_address: payee2, chain: 'base', amount_usdc: 12.34, reason: 'legacy caller, no asset' });
  await api('POST', `/payouts/${p3.body.data.id}/submit`, {});
  check('a legacy request (amount_usdc, no asset) still pays USDC', p3.body.data.asset === 'USDC' && (await tokens.USDC.balanceOf(payee2)) === 12_340_000n);
  const p4 = await api('POST', '/payouts', { external_id: 'e2e-z2', payee_id: 'contrib-4', payee_address: payee, chain: 'base', amount_usd: 500, asset: 'ZARP', reason: 'large' });
  check('a large ZARP payout waits for approval (judged in USD)', p4.body.requires_approval === true && p4.body.data.status === 'pending_approval');
  check('and cannot be submitted until approved', (await api('POST', `/payouts/${p4.body.data.id}/submit`, {})).status >= 400);
  await api('POST', `/payouts/${p4.body.data.id}/approve`, { approved_by: 'ops' });
  const sub4 = await api('POST', `/payouts/${p4.body.data.id}/submit`, {});
  check('once approved it is sent at the rate it was created at (19, since the rate had moved)', sub4.body.data?.status === 'confirmed' && sub4.body.data.fxRate === '19' && (await tokens.ZARP.balanceOf(payee)) === (925n + 9500n) * 10n ** 18n);
  // Leave the hot wallet with about $10k of OUSD, then ask for $20k.
  await (await tokens.OUSD.connect(signer.connect(provider)).transfer(funder.address, 90_000_000_000n)).wait();
  const p5 = await api('POST', '/payouts', { external_id: 'e2e-big', payee_id: 'c', payee_address: payee, chain: 'base', amount_usd: 20000, asset: 'OUSD', reason: 'too big for the wallet' });
  await api('POST', `/payouts/${p5.body.data.id}/approve`, { approved_by: 'ops' });
  const sub5 = await api('POST', `/payouts/${p5.body.data.id}/submit`, {});
  check('a payout the hot wallet cannot cover fails clearly and is not retried', sub5.status >= 400 && /short of/.test(sub5.body?.message ?? JSON.stringify(sub5.body)) && (await api('GET', `/payouts/${p5.body.data.id}`)).body.data.status === 'failed', sub5.body?.message);
  check('a payout over the USD ceiling is refused up front', (await api('POST', '/payouts', { external_id: 'e2e-huge', payee_id: 'c', payee_address: payee, chain: 'base', amount_usd: 90000, asset: 'ZARP', reason: 'x' })).status === 400);
  check('an unknown asset is refused', (await api('POST', '/payouts', { external_id: 'e2e-x', payee_id: 'c', payee_address: payee, chain: 'base', amount_usd: 1, asset: 'DOGE', reason: 'x' })).status === 400);


  console.log('9. Approved payouts are sent automatically, and interrupted ones are settled from the chain');
  await stopGateway();
  await startGateway({ PAYOUT_AUTO_SUBMIT: 'true' });
  const getPayout = async (id) => (await api('GET', `/payouts/${id}`)).body.data;
  const payeeA = ethers.Wallet.createRandom().address;
  const a1 = await api('POST', '/payouts', { external_id: 'e2e-auto-1', payee_id: 'c', payee_address: payeeA, chain: 'base', amount_usd: 30, asset: 'OUSD', reason: 'auto' });
  const a1done = await waitFor(async () => { const p = await getPayout(a1.body.data.id); return p.status === 'confirmed' ? p : null; }, 20000);
  check('a small payout is sent with no one calling submit', !!a1done && (await tokens.OUSD.balanceOf(payeeA)) === 30_000_000n);
  check('its transaction hash is on the ledger', /^0x[0-9a-f]{64}$/.test(a1done?.txHash ?? ''));
  const a2 = await api('POST', '/payouts', { external_id: 'e2e-auto-2', payee_id: 'c', payee_address: payeeA, chain: 'base', amount_usd: 500, asset: 'OUSD', reason: 'big' });
  await sleep(3500);
  check('a large payout is NOT sent until a person approves it', (await getPayout(a2.body.data.id)).status === 'pending_approval' && (await tokens.OUSD.balanceOf(payeeA)) === 30_000_000n);
  await api('POST', `/payouts/${a2.body.data.id}/approve`, { approved_by: 'ops' });
  const a2done = await waitFor(async () => { const p = await getPayout(a2.body.data.id); return p.status === 'confirmed' ? p : null; }, 20000);
  check('once approved it is sent by the worker', !!a2done && (await tokens.OUSD.balanceOf(payeeA)) === 530_000_000n);

  // A payout left 'submitted' by a crash. The ledger holds a hash if the transaction was sent.
  // The crash that matters: the transfer was sent and mined, but the process died before the ledger said so.
  // Recreated by putting a real, confirmed payout back to 'submitted' with its hash still on it.
  await db.query(`UPDATE payouts SET status = 'submitted', updated_at = now() - interval '1 hour' WHERE id = $1`, [a2.body.data.id]);
  const ins = (id, hash, ageSql) => db.query(
    `INSERT INTO payouts (id, external_id, payee_id, payee_address, chain, amount_usdc, amount_usd, asset, amount_units, decimals, status, reason, requested_by, tx_hash, updated_at)
     VALUES (gen_random_uuid(), $1, 'c', $2, 'base', 5, 5, 'OUSD', '5000000', 6, 'submitted', 'recovery test', 'e2e-bureau', $3, ${ageSql}) RETURNING id`, [id, payeeA, hash]).then((r) => r.rows[0].id);
  const rConfirmed = a2.body.data.id;
  const rNoHash = await ins('rec-nohash', null, "now() - interval '1 hour'");
  const rUnknown = await ins('rec-unknown', '0x' + 'ab'.repeat(32), "now() - interval '1 hour'");
  const rFresh = await ins('rec-fresh', null, 'now()');
  const before = await tokens.OUSD.balanceOf(payeeA);
  await waitFor(async () => (await getPayout(rConfirmed)).status === 'confirmed', 15000);
  check('a payout whose transaction is on-chain is closed as confirmed, and nothing is sent again', (await getPayout(rConfirmed)).status === 'confirmed' && (await tokens.OUSD.balanceOf(payeeA)) === before);
  const nh = await waitFor(async () => { const p = await getPayout(rNoHash); return p.status === 'failed' ? p : null; }, 15000);
  check('one with no hash is marked failed, with the reason, and is NOT retried (it might already have been sent)', !!nh && /may or may not have been sent/.test(nh.failureReason ?? '') && (await tokens.OUSD.balanceOf(payeeA)) === before);
  check('one whose transaction the chain has never heard of stays in flight, not guessed at', (await getPayout(rUnknown)).status === 'submitted');
  check('one claimed a moment ago is left alone', (await getPayout(rFresh)).status === 'submitted');

  console.log('10. Deposits are swept to the treasury');
  const treasury = ethers.Wallet.createRandom().address;
  const gasWallet = ethers.Wallet.createRandom();
  await (await funder.sendTransaction({ to: gasWallet.address, value: ethers.parseEther('20') })).wait();
  if (process.env.E2E_KEY_WRAP === 'vault') {
    await fetch(`${process.env.VAULT_ADDR}/v1/sys/mounts/transit`, { method: 'POST', headers: { 'x-vault-token': process.env.VAULT_TOKEN }, body: JSON.stringify({ type: 'transit' }) }).catch(() => {});
    await fetch(`${process.env.VAULT_ADDR}/v1/transit/keys/e2e-deposit-keys`, { method: 'POST', headers: { 'x-vault-token': process.env.VAULT_TOKEN }, body: '{}' });
  }
  const sweepEnv = { SWEEP_ENABLED: 'true', SWEEP_TREASURY_ADDRESS: treasury, SWEEP_GAS_PRIVATE_KEY: gasWallet.privateKey, SWEEP_CHAIN_ID_BASE: '1337', SWEEP_MIN_USD: '1' };
  const expected = Object.fromEntries((await db.query(`SELECT token, SUM(received_amount_units::numeric)::text AS total FROM stablecoin_deposits WHERE status='confirmed' AND amount_usd >= 1 AND swept_at IS NULL GROUP BY token`)).rows.map((r) => [r.token, BigInt(r.total.split('.')[0])]));
  const confirmedIds = (await db.query(`SELECT id FROM stablecoin_deposits WHERE status='confirmed' AND amount_usd >= 1`)).rows.map((r) => r.id);
  const blob = (await db.query(`SELECT private_key_enc FROM stablecoin_deposits WHERE id=$1`, [confirmedIds[0]])).rows[0].private_key_enc;
  check(`deposit keys are stored as sealed envelopes (${process.env.E2E_KEY_WRAP === 'vault' ? 'Vault-wrapped' : 'env-wrapped'}), never plain`, JSON.parse(blob).v === 2 && JSON.parse(blob).wrap.provider === (process.env.E2E_KEY_WRAP === 'vault' ? 'vault' : 'env') && !/0x[0-9a-f]{64}/i.test(blob));
  await stopGateway();
  await startGateway({ ...sweepEnv });
  const allSwept = await waitFor(async () => Number((await db.query(`SELECT count(*)::int n FROM stablecoin_deposits WHERE id = ANY($1) AND swept_at IS NULL`, [confirmedIds])).rows[0].n) === 0, 60000, 800);
  check(`every confirmed deposit (${confirmedIds.length}) is swept`, !!allSwept);
  for (const sym of ['ZARP', 'OUSD', 'USDC']) {
    const got = await tokens[sym].balanceOf(treasury);
    check(`the treasury received exactly what was paid in, in ${sym}`, got === (expected[sym] ?? 0n), `${got} vs ${expected[sym] ?? 0n}`);
  }
  const swept = (await db.query(`SELECT * FROM deposit_sweeps WHERE status='swept'`)).rows;
  check('each sweep records its gas transfer and its token transfer', swept.length >= confirmedIds.length && swept.every((r) => /^0x/.test(r.sweep_tx) && r.units));
  const sample = (await db.query(`SELECT d.address, d.token FROM stablecoin_deposits d JOIN deposit_sweeps s ON s.deposit_id = d.id WHERE s.status='swept' LIMIT 1`)).rows[0];
  check('a swept address holds none of the token any more', (await tokens[sample.token].balanceOf(sample.address)) === 0n);
  check('and only dust of native coin, not the gas it was given', (await provider.getBalance(sample.address)) < ethers.parseEther('0.001'));
  const cfg = (await api('GET', '/sweeps/config')).body;
  check('the operator can see the treasury and the gas wallet', cfg.enabled === true && cfg.chains.base.treasury === ethers.getAddress(treasury) && cfg.chains.base.gas_wallet === gasWallet.address);

  // Funds the automatic pass must not touch: late payments, and deposits still open.
  const lateOusdBefore = await tokens.OUSD.balanceOf(treasury);
  check('a late payment to an expired address is left where it is', (await tokens.OUSD.balanceOf(late2.body.pay_to)) === 5_000_000n);
  check('an operator must say why to sweep unclaimed funds', (await api('POST', '/sweeps', { deposit_id: late2.body.deposit_id })).status === 400);
  check('and cannot sweep a deposit that is still open', (await api('POST', '/sweeps', { deposit_id: dep.body.id, reason: 'testing an open deposit' })).status === 409);
  const man = await api('POST', '/sweeps', { deposit_id: late2.body.deposit_id, reason: 'late payment, refunding not possible' });
  check('with a reason, it is planned', man.status === 201 && man.body.data.reason === 'late payment, refunding not possible');
  await waitFor(async () => (await tokens.OUSD.balanceOf(treasury)) === lateOusdBefore + 5_000_000n, 30000);
  check('and swept', (await tokens.OUSD.balanceOf(treasury)) === lateOusdBefore + 5_000_000n);

  // Crash recovery: a sweep left 'sending' is settled from the chain, never sent twice.
  const mk = async (token, usd, sym) => { const d = await api('POST', '/deposits', { merchant_id: 'sw', amount_usd: usd, token, chain: 'base' }); return d.body; };
  const pays = async (sym, d) => { await (await tokens[sym].transfer(d.address, BigInt(d.amount_units))).wait(); await mine(3); await waitFor(async () => (await db.query(`SELECT status FROM stablecoin_deposits WHERE id=$1`, [d.id])).rows[0].status === 'confirmed', 25000); };
  const tBefore = await tokens.USDC.balanceOf(treasury);
  const d1 = await mk('USDC', 5); await db.query(`UPDATE stablecoin_deposits SET status='confirmed' WHERE id=$1`, [d1.id]);
  const goodHash = swept[0].sweep_tx;
  await db.query(`INSERT INTO deposit_sweeps (id, deposit_id, chain, asset, from_address, treasury_address, status, sweep_tx, units) VALUES (gen_random_uuid(), $1, 'base', 'USDC', $2, $3, 'sending', $4, '5000000')`, [d1.id, d1.address, ethers.getAddress(treasury), goodHash]);
  await waitFor(async () => (await db.query(`SELECT status FROM deposit_sweeps WHERE deposit_id=$1`, [d1.id])).rows[0].status === 'swept', 15000);
  check('a sweep left "sending" whose transaction is mined is closed from the chain, sending nothing more', (await db.query(`SELECT swept_at FROM stablecoin_deposits WHERE id=$1`, [d1.id])).rows[0].swept_at !== null && (await tokens.USDC.balanceOf(treasury)) === tBefore);
  const d2 = await mk('USDC', 5); await db.query(`UPDATE stablecoin_deposits SET status='confirmed' WHERE id=$1`, [d2.id]);
  await db.query(`INSERT INTO deposit_sweeps (id, deposit_id, chain, asset, from_address, treasury_address, status, sweep_tx, updated_at) VALUES (gen_random_uuid(), $1, 'base', 'USDC', $2, $3, 'sending', $4, now() - interval '1 hour')`, [d2.id, d2.address, ethers.getAddress(treasury), '0x' + 'cd'.repeat(32)]);
  const dropped = await waitFor(async () => { const r = (await db.query(`SELECT * FROM deposit_sweeps WHERE deposit_id=$1`, [d2.id])).rows[0]; return r.status === 'failed' ? r : null; }, 15000);
  check('one with no receipt after a long time is failed for a person to look at, not guessed', !!dropped && /may have been dropped/.test(dropped.error));
  const retried = await api('POST', `/sweeps/${dropped.id}/retry`, {});
  check('after a look, retrying puts it back; the empty address is found empty and closed', retried.status === 200 && !!(await waitFor(async () => (await db.query(`SELECT status FROM deposit_sweeps WHERE id=$1`, [dropped.id])).rows[0].status === 'skipped', 15000)));

  // A key blob moved onto another deposit must not release that deposit's funds.
  const d3 = await mk('USDC', 5); await pays('USDC', d3);
  const d3row = (await db.query(`SELECT private_key_enc FROM stablecoin_deposits WHERE id=$1`, [d3.id])).rows[0];
  check('(the deposit above was swept normally)', !!(await waitFor(async () => (await db.query(`SELECT swept_at FROM stablecoin_deposits WHERE id=$1`, [d3.id])).rows[0].swept_at !== null, 30000)));
  const d4 = await mk('USDC', 5);
  const d4good = (await db.query(`SELECT private_key_enc FROM stablecoin_deposits WHERE id=$1`, [d4.id])).rows[0].private_key_enc;
  await db.query(`UPDATE stablecoin_deposits SET private_key_enc=$2 WHERE id=$1`, [d4.id, d3row.private_key_enc]); // another deposit's blob
  await (await tokens.USDC.transfer(d4.address, BigInt(d4.amount_units))).wait(); await mine(3);
  const tBefore2 = await tokens.USDC.balanceOf(treasury);
  const failedSweep = await waitFor(async () => { const r = (await db.query(`SELECT * FROM deposit_sweeps WHERE deposit_id=$1 AND status='failed'`, [d4.id])).rows[0]; return r ?? null; }, 40000);
  check("a key blob copied from another deposit is refused, and that deposit's funds stay put", !!failedSweep && /could not open the deposit key/.test(failedSweep.error) && (await tokens.USDC.balanceOf(d4.address)) === BigInt(d4.amount_units) && (await tokens.USDC.balanceOf(treasury)) === tBefore2);
  await db.query(`UPDATE stablecoin_deposits SET private_key_enc=$2 WHERE id=$1`, [d4.id, d4good]);
  await api('POST', `/sweeps/${failedSweep.id}/retry`, {});
  await waitFor(async () => (await tokens.USDC.balanceOf(treasury)) === tBefore2 + BigInt(d4.amount_units), 40000);
  check('with the right blob restored and the sweep retried, it goes through', (await tokens.USDC.balanceOf(treasury)) === tBefore2 + BigInt(d4.amount_units));

  // Gas too expensive: defer, don't pay it.
  await stopGateway();
  await startGateway({ ...sweepEnv, SWEEP_MAX_GAS_GWEI: '0.000001' });
  const d5 = await mk('USDC', 5); await pays('USDC', d5);
  await sleep(6000);
  const s5 = (await db.query(`SELECT * FROM deposit_sweeps WHERE deposit_id=$1`, [d5.id])).rows[0];
  check('above the gas ceiling a sweep waits: nothing sent, nothing failed', (!s5 || (s5.status === 'planned' && !s5.gas_tx)) && (await tokens.USDC.balanceOf(d5.address)) === BigInt(d5.amount_units));
  await stopGateway();
  await startGateway({ ...sweepEnv });
  await waitFor(async () => (await tokens.USDC.balanceOf(d5.address)) === 0n, 40000);
  check('with gas back under the ceiling it is swept', (await tokens.USDC.balanceOf(d5.address)) === 0n);


  console.log('11. Dust comes back, and tokens sent to the wrong address can be recovered');
  const dustRows = (await db.query(`SELECT * FROM deposit_sweeps WHERE status='swept' AND dust_tx IS NOT NULL`)).rows;
  check('sweeps return their leftover gas to the gas wallet', dustRows.length >= 1 && dustRows.every((r) => /^0x/.test(r.dust_tx) && BigInt(r.dust_wei) > 0n), `${dustRows.length} of ${swept.length} returned some`);
  check('a swept address is left with next to nothing', dustRows.length > 0 && (await provider.getBalance(dustRows[0].from_address)) < ethers.parseEther('0.0001'));

  const refund = ethers.Wallet.createRandom().address;
  const strays = (await api('GET', `/sweeps/strays/${w.body.deposit_id}`)).body.data;
  const zs = strays.strays.find((x) => x.asset === 'ZARP'), os = strays.strays.find((x) => x.asset === 'OUSD');
  check('the wrong tokens sent to a USDC deposit address are listed, with who sent them', zs?.units === (10n ** 24n).toString() && os?.units === '50000000' && zs.senders.includes(funder.address) && os.senders.includes(funder.address));
  check('recovery needs a reason', (await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: 'OUSD', destination: refund })).status === 400);
  check('it will not send to the deposit address itself', (await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: 'OUSD', destination: w.body.pay_to, reason: 'testing' })).status === 409);
  check("and will not treat the deposit's own token as a stray", (await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: 'USDC', destination: refund, reason: 'testing' })).status === 409);
  check('or a token it has never heard of, unless the contract is named', (await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: 'DOGE', destination: refund, reason: 'testing' })).status === 409);
  const rec = await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: 'OUSD', destination: refund, reason: 'payer sent OUSD to a USDC payment' });
  check('with a reason and a destination it is planned as a recovery', rec.status === 201 && rec.body.data.kind === 'recovery' && rec.body.data.treasury_address === ethers.getAddress(refund));
  await waitFor(async () => (await tokens.OUSD.balanceOf(refund)) === 50_000_000n, 30000);
  check('the OUSD goes back to the address the operator named, not to the treasury', (await tokens.OUSD.balanceOf(refund)) === 50_000_000n && (await tokens.OUSD.balanceOf(w.body.pay_to)) === 0n);
  await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: 'ZARP', destination: refund, reason: 'payer sent ZARP to a USDC payment' });
  await waitFor(async () => (await tokens.ZARP.balanceOf(refund)) === 10n ** 24n, 30000);
  check('and the ZARP the same, at 18 decimals', (await tokens.ZARP.balanceOf(refund)) === 10n ** 24n);
  check("recovering strays does not disturb the deposit's own record", (await db.query(`SELECT status, swept_at FROM stablecoin_deposits WHERE id=$1`, [w.body.deposit_id])).rows[0].swept_at !== null);
  const junk = await deploy('JUNK', 6);
  await (await junk.mint(funder.address, 1000n)).wait();
  await (await junk.transfer(w.body.pay_to, 123n)).wait();
  check('a token nobody configured is not listed...', !(await api('GET', `/sweeps/strays/${w.body.deposit_id}`)).body.data.strays.some((x) => x.asset === 'JUNK'));
  await api('POST', '/sweeps/recover', { deposit_id: w.body.deposit_id, asset: await junk.getAddress(), destination: refund, reason: 'unrecognised token sent in error' });
  await waitFor(async () => (await junk.balanceOf(refund)) === 123n, 30000);
  check('...but can be recovered when an operator names its contract', (await junk.balanceOf(refund)) === 123n);

  console.log('12. The treasury keeps the payout wallet funded');
  const warm = ethers.Wallet.createRandom();
  const cold = ethers.Wallet.createRandom().address;
  await (await funder.sendTransaction({ to: warm.address, value: ethers.parseEther('5') })).wait();
  await (await tokens.USDC.mint(warm.address, 50_000_000_000n)).wait();
  await (await tokens.OUSD.mint(warm.address, 50_000_000_000n)).wait();
  await (await tokens.ZARP.mint(warm.address, 1_000_000n * 10n ** 18n)).wait();
  // Run the payout wallet nearly dry.
  const sw = signer.connect(provider);
  const leave = { USDC: 10_000_000n, OUSD: 50_000_000n, ZARP: 1n * 10n ** 18n };
  for (const sym of Object.keys(leave)) { const b = await tokens[sym].balanceOf(signer.address); if (b > leave[sym]) await (await tokens[sym].connect(sw).transfer(funder.address, b - leave[sym])).wait(); }
  const nat = await provider.getBalance(signer.address);
  await (await sw.sendTransaction({ to: funder.address, value: nat - ethers.parseEther('0.0015') })).wait();
  const rate = (await api('GET', '/assets')).body.rates['USD/ZAR'].rate;
  const treasuryEnv = {
    TREASURY_MANAGER_ENABLED: 'true', TREASURY_WARM_PRIVATE_KEY: warm.privateKey, TREASURY_CHAIN_ID: '1337', TREASURY_INTERVAL_MS: '1000',
    REPLENISH_LOW_USD: '100', REPLENISH_TARGET_USD: '400', REPLENISH_DAILY_MAX_USD: '100000',
    TREASURY_WARM_MAX_USD: '10000000', TREASURY_WARM_TARGET_USD: '5000000', PAYOUT_AUTO_SUBMIT: 'true',
  };
  await stopGateway();
  await startGateway({ ...treasuryEnv });
  const target = { USDC: 400_000_000n, OUSD: 400_000_000n, ZARP: ethers.parseUnits(String(400 * Number(rate)), 18) };
  await waitFor(async () => (await Promise.all(Object.keys(target).map(async (k) => (await tokens[k].balanceOf(signer.address)) === target[k]))).every(Boolean), 40000);
  for (const k of Object.keys(target)) check(`${k}: a nearly empty payout wallet is topped up to exactly the $400 target`, (await tokens[k].balanceOf(signer.address)) === target[k], `${await tokens[k].balanceOf(signer.address)}`);
  check('its native gas is topped up to the target too', (await provider.getBalance(signer.address)) === ethers.parseEther('0.02'));
  const st0 = (await api('GET', '/treasury/status')).body;
  check('the operator can see both wallets and the float', st0.enabled && st0.payout_wallet === signer.address && st0.operating_wallet === warm.address && st0.assets.find((a) => a.asset === 'OUSD').payout_units === '400000000');
  const tl = (await api('GET', '/treasury/transfers')).body.data;
  check('every move is in the ledger with its hash', tl.length >= 4 && tl.every((t) => t.status === 'confirmed' && /^0x/.test(t.tx)));

  // Demand: an approved payout bigger than the float. It must wait for funds, then be paid — not fail.
  const payeeT = ethers.Wallet.createRandom().address;
  const big = await api('POST', '/payouts', { external_id: 'e2e-treasury-big', payee_id: 'c', payee_address: payeeT, chain: 'base', amount_usd: 1000, asset: 'OUSD', reason: 'bigger than the float' });
  await api('POST', `/payouts/${big.body.data.id}/approve`, { approved_by: 'ops' });
  const paidBig = await waitFor(async () => { const p = await getPayout(big.body.data.id); return p.status === 'confirmed' ? p : (p.status === 'failed' ? p : null); }, 40000);
  check('an approved payout larger than the wallet holds is funded for and paid, not failed', paidBig?.status === 'confirmed' && (await tokens.OUSD.balanceOf(payeeT)) === 1_000_000_000n, paidBig?.failureReason);
  check('the wallet is left with exactly its floor', (await tokens.OUSD.balanceOf(signer.address)) === 100_000_000n);

  // The daily cap: reached means a reported shortfall and a payout that waits — never a silently raised limit.
  const used = (await api('GET', '/treasury/status')).body.used_24h_usd;
  await stopGateway();
  await startGateway({ ...treasuryEnv, REPLENISH_DAILY_MAX_USD: String(Math.ceil(used) + 50) });
  const capped = await api('POST', '/payouts', { external_id: 'e2e-treasury-cap', payee_id: 'c', payee_address: payeeT, chain: 'base', amount_usd: 2000, asset: 'OUSD', reason: 'more than the cap allows today' });
  await api('POST', `/payouts/${capped.body.data.id}/approve`, { approved_by: 'ops' });
  const sf = await waitFor(async () => { const s = (await api('GET', '/treasury/status')).body; return s.shortfalls.find((x) => x.asset === 'OUSD') ?? null; }, 30000);
  check('at the daily cap the gap is reported as a shortfall, with the reason', !!sf && /daily replenishment cap/.test(sf.reason), JSON.stringify(sf));
  await sleep(2500);
  check('and the payout waits, approved, rather than failing', (await getPayout(capped.body.data.id)).status === 'approved');
  check('the cap held: no more than was allowed was sent', (await api('GET', '/treasury/status')).body.used_24h_usd <= Math.ceil(used) + 50 + 0.01);
  await stopGateway();
  await startGateway({ ...treasuryEnv });
  const paidCap = await waitFor(async () => { const p = await getPayout(capped.body.data.id); return p.status === 'confirmed' ? p : null; }, 40000);
  check('with the cap raised by an operator, it is funded and paid', !!paidCap && (await tokens.OUSD.balanceOf(payeeT)) === 3_000_000_000n);

  // Crash recovery of the treasury's own ledger.
  const confirmedRow = (await db.query(`SELECT id, tx FROM treasury_transfers WHERE status='confirmed' AND tx IS NOT NULL LIMIT 1`)).rows[0];
  await db.query(`UPDATE treasury_transfers SET status='sent' WHERE id=$1`, [confirmedRow.id]);
  await db.query(`INSERT INTO treasury_transfers (id, kind, chain, asset, from_address, to_address, units, status, updated_at) VALUES (gen_random_uuid(), 'replenish', 'base', 'USDC', $1, $2, '1', 'planned', now() - interval '1 hour')`, [warm.address, signer.address]);
  await waitFor(async () => (await db.query(`SELECT status FROM treasury_transfers WHERE id=$1`, [confirmedRow.id])).rows[0].status === 'confirmed', 20000);
  check('a transfer left "sent" is settled from the chain', (await db.query(`SELECT status FROM treasury_transfers WHERE id=$1`, [confirmedRow.id])).rows[0].status === 'confirmed');
  const interrupted = await waitFor(async () => (await db.query(`SELECT * FROM treasury_transfers WHERE status='failed' AND error LIKE '%interrupted%'`)).rows[0] ?? null, 20000);
  check('one that never got a hash is marked failed and not assumed either way', !!interrupted);

  // Surplus goes to cold storage, leaving the target behind.
  const warmBefore = { USDC: await tokens.USDC.balanceOf(warm.address), OUSD: await tokens.OUSD.balanceOf(warm.address), ZARP: await tokens.ZARP.balanceOf(warm.address) };
  await stopGateway();
  await startGateway({ ...treasuryEnv, TREASURY_COLD_ADDRESS: cold, TREASURY_WARM_MAX_USD: '20000', TREASURY_WARM_TARGET_USD: '5000' });
  const warmTarget = { USDC: 5_000_000_000n, OUSD: 5_000_000_000n, ZARP: ethers.parseUnits(String(5000 * Number(rate)), 18) };
  await waitFor(async () => (await Promise.all(Object.keys(warmTarget).map(async (k) => (await tokens[k].balanceOf(warm.address)) === warmTarget[k]))).every(Boolean), 50000);
  for (const k of Object.keys(warmTarget)) {
    const cb = await tokens[k].balanceOf(cold);
    check(`${k}: the operating wallet above its ceiling is cut back to $5,000 and the rest goes to cold storage`, (await tokens[k].balanceOf(warm.address)) === warmTarget[k] && cb === warmBefore[k] - warmTarget[k], `cold holds ${cb}`);
  }
  check('nothing in this service can move money out of the cold address (it has no key for it)', (await api('GET', '/treasury/status')).body.cold_address === ethers.getAddress(cold));

  console.log('8. A wrong address is caught, not trusted');
  await stopGateway();
  await startGateway({ ASSET_ZARP_BASE: addr.OUSD }); // ZARP configured to OUSD's contract
  a = (await api('GET', '/assets')).body;
  check('ZARP pointed at a contract that calls itself OUSD is unavailable, with the reason', st('ZARP')?.status === 'unavailable' && /calls itself "OUSD", not ZARP/.test(st('ZARP').problem || ''), st('ZARP')?.problem);
  const bad = await api('POST', '/x402/pay', { resource_url: 'r', merchant_id: 'm', amount_usd: 1, asset: 'ZARP' });
  check('so a ZARP payment is refused', bad.status === 503 && bad.body.error === 'AssetUnavailable');
  check('while USDC and OUSD still work', (await api('POST', '/x402/pay', { resource_url: 'r', merchant_id: 'm', amount_usd: 1, asset: 'OUSD' })).status === 201);
  await stopGateway();
  await startGateway({ ASSET_ZARP_BASE_DECIMALS: '6' }); // pinned decimals disagree with the contract's 18
  a = (await api('GET', '/assets')).body;
  check('decimals pinned to a value the contract contradicts disable the asset', st('ZARP')?.status === 'unavailable' && /reports 18 decimals, configured 6/.test(st('ZARP').problem || ''));

  await stopGateway();
  await db.end();
  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('SCRIPT FAILED:', e.stack || e.message); await stopGateway().catch(() => {}); process.exit(1); });
