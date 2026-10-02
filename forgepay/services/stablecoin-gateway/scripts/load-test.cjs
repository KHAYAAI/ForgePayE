#!/usr/bin/env node
/**
 * Load test: the real gateway (tsx), a real Postgres, a real ERC-20 on a local chain (ganache).
 * Measures, with pass/fail thresholds:
 *   A  opening deposits at concurrency              (latency percentiles, errors)
 *   B  paying many deposits and how long settlement takes to confirm every one, with exact balances
 *   C  creating and approving payouts at concurrency
 *   D  steady read traffic
 *   E  the rate limit actually limits
 *
 * What this is NOT: a test of mainnet RPC behaviour, of a multi-replica deployment, or of the threshold
 * signer. A local chain mines instantly and has no network latency, so confirmation times here are a floor.
 *
 *   LOAD_DEPOSITS=400 LOAD_PAID=60 LOAD_PAYOUTS=150 node scripts/load-test.cjs
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const GW = process.env.GW_DIR || path.resolve(__dirname, '..');
const { ethers } = require(require.resolve('ethers', { paths: [GW] }));
const { Pool } = require(require.resolve('pg', { paths: [GW] }));

const RPC = process.env.RPC_URL || 'http://127.0.0.1:8545';
const PORT = Number(process.env.GW_PORT || 8022);
const BASE = `http://127.0.0.1:${PORT}`;
const DB = 'forgepay_sgw_load';
const PG = { host: process.env.PGHOST || 'localhost', user: process.env.PGUSER || 'forgepay', password: process.env.PGPASSWORD || 'devpassword' };
const MNEMONIC = process.env.FUNDER_MNEMONIC || 'test test test test test test test test test test test junk';
const N_DEP = Number(process.env.LOAD_DEPOSITS || 400), N_PAID = Number(process.env.LOAD_PAID || 60), N_PAY = Number(process.env.LOAD_PAYOUTS || 150), N_READ = Number(process.env.LOAD_READS || 600);
const CONC = Number(process.env.LOAD_CONCURRENCY || 30);

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const stats = (xs) => `p50 ${pct(xs, .5).toFixed(0)}ms  p95 ${pct(xs, .95).toFixed(0)}ms  p99 ${pct(xs, .99).toFixed(0)}ms  max ${Math.max(0, ...xs).toFixed(0)}ms`;

const H = { 'content-type': 'application/json', authorization: 'Bearer load-admin', 'x-forge-service': 'load-test' };
async function timed(method, p, body) {
  const t0 = performance.now();
  const r = await fetch(BASE + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => null);
  return { status: r.status, body: json, ms: performance.now() - t0 };
}
async function pool(n, conc, fn) {
  const out = new Array(n); let next = 0;
  await Promise.all(Array.from({ length: conc }, async () => { for (;;) { const i = next++; if (i >= n) return; out[i] = await fn(i); } }));
  return out;
}

(async () => {
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { staticNetwork: ethers.Network.from(1337), cacheTimeout: -1 });
  const funder = ethers.HDNodeWallet.fromPhrase(MNEMONIC).connect(provider);
  const fixture = JSON.parse(fs.readFileSync(path.join(GW, 'tests/fixtures/MockToken.json'), 'utf8'));
  const admin = new Pool({ ...PG, database: 'postgres' });
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`); await admin.query(`CREATE DATABASE ${DB}`); await admin.end();
  const db = new Pool({ ...PG, database: DB });
  const usdc = await new ethers.ContractFactory(fixture.abi, fixture.bytecode, funder).deploy('USDC', 6);
  await usdc.waitForDeployment();
  await (await usdc.mint(funder.address, ethers.parseUnits('1000000000', 6))).wait();
  const signer = ethers.Wallet.createRandom();
  await (await funder.sendTransaction({ to: signer.address, value: ethers.parseEther('1') })).wait();

  const log = fs.openSync(`${GW}/.load-gateway.log`, 'w');
  const gw = spawn(path.join(GW, 'node_modules/.bin/tsx'), ['src/index.ts'], {
    cwd: GW, stdio: ['ignore', log, log],
    env: {
      ...process.env, NODE_ENV: 'development', PORT: String(PORT), POSTGRES_HOST: PG.host, POSTGRES_DB: DB, POSTGRES_USER: PG.user, POSTGRES_PASSWORD: PG.password,
      INTERNAL_WEBHOOK_SECRET: 'load', BASE_RPC_URL: RPC, BASE_CHAIN_ID: '1337', BASE_CONFIRMATIONS: '2', DEPOSIT_MONITOR_CHAINS: 'base',
      SETTLEMENT_INTERVAL_MS: '700', ASSET_VERIFY_INTERVAL_MS: '600000', ASSETS_ENABLED: 'USDC', ASSET_USDC_BASE: await usdc.getAddress(),
      ASSET_USDC_ETHEREUM: 'off', ASSET_USDC_POLYGON: 'off', ASSET_USDC_ARBITRUM: 'off',
      PAYOUT_AUTO_APPROVE_MAX_USD: '0', PAYOUT_ABSOLUTE_MAX_USD: '100000', RATE_LIMIT_PER_MIN: String(process.env.LOAD_RATE_LIMIT || 100000),
    },
  });
  const stop = () => { try { gw.kill('SIGTERM'); } catch {} };
  process.on('exit', stop);
  for (let i = 0; i < 120; i++) { if (await fetch(`${BASE}/healthz`).then((r) => r.ok).catch(() => false)) break; await sleep(500); }

  try {
    console.log(`A. Opening ${N_DEP} deposits at concurrency ${CONC}`);
    const t0 = performance.now();
    const opened = await pool(N_DEP, CONC, () => timed('POST', '/deposits', { merchant_id: 'load', amount_usd: 3, token: 'USDC', chain: 'base' }));
    const dt = (performance.now() - t0) / 1000;
    const bad = opened.filter((o) => o.status !== 201 && o.status !== 200);
    console.log(`  ${(N_DEP / dt).toFixed(1)} deposits/s; ${stats(opened.map((o) => o.ms))}`);
    check('every deposit opened without error', bad.length === 0, bad.length ? `${bad.length} failed, first ${JSON.stringify(bad[0].body).slice(0, 160)}` : '');
    check('p95 latency of opening a deposit is under 1500ms', pct(opened.map((o) => o.ms), .95) < 1500);
    const addrs = new Set(opened.map((o) => o.body?.address));
    check('every deposit got its own address', addrs.size === opened.filter((o) => o.body?.address).length);

    console.log(`B. Paying ${N_PAID} of them and waiting for settlement to confirm each`);
    const toPay = opened.filter((o) => o.body?.address).slice(0, N_PAID).map((o) => o.body);
    let nonce = await provider.getTransactionCount(funder.address, 'pending');
    const sends = [];
    const tPay = performance.now();
    for (const d of toPay) sends.push(usdc.connect(funder).transfer(d.address, BigInt(d.amount_units), { nonce: nonce++ }).then((t) => t.wait()));
    await Promise.all(sends);
    for (let i = 0; i < 3; i++) await provider.send('evm_mine', []);
    const ids = toPay.map((d) => d.id);
    let confirmed = 0, waited = 0;
    while (waited < 90000) {
      confirmed = Number((await db.query(`SELECT count(*) c FROM stablecoin_deposits WHERE id = ANY($1) AND status='confirmed'`, [ids])).rows[0].c);
      if (confirmed === ids.length) break;
      await sleep(500); waited += 500;
    }
    const settleSec = (performance.now() - tPay) / 1000;
    console.log(`  ${confirmed}/${ids.length} confirmed after ${settleSec.toFixed(1)}s (local chain: a floor, not a forecast)`);
    check('every paid deposit was confirmed', confirmed === ids.length);
    const rows = (await db.query(`SELECT id, amount_units, received_amount_units FROM stablecoin_deposits WHERE id = ANY($1)`, [ids])).rows;
    check('each credited exactly what was paid, to the unit', rows.every((r) => r.received_amount_units === r.amount_units));
    const unpaid = opened.filter((o) => o.body?.address).slice(N_PAID, N_PAID + 20).map((o) => o.body.id);
    const wrong = Number((await db.query(`SELECT count(*) c FROM stablecoin_deposits WHERE id = ANY($1) AND status='confirmed'`, [unpaid])).rows[0].c);
    check('deposits nobody paid were not confirmed', wrong === 0);

    console.log(`C. Creating and approving ${N_PAY} payouts at concurrency ${Math.min(CONC, 20)}`);
    const pays = await pool(N_PAY, Math.min(CONC, 20), async (i) => {
      const c = await timed('POST', '/payouts', { external_id: `load-${i}`, payee_id: `f${i}`, payee_address: ethers.Wallet.createRandom().address, amount_usd: 10, asset: 'USDC', reason: 'load' });
      if (c.status !== 201) return c;
      const a = await timed('POST', `/payouts/${c.body.data.id}/approve`, { approved_by: 'ops' });
      return { status: a.status, ms: c.ms + a.ms };
    });
    console.log(`  ${stats(pays.map((p) => p.ms))}`);
    check('every payout was created and approved', pays.every((p) => p.status === 200), `${pays.filter((p) => p.status !== 200).length} failed`);
    const dup = await timed('POST', '/payouts', { external_id: 'load-0', payee_id: 'f0', payee_address: ethers.Wallet.createRandom().address, amount_usd: 10, asset: 'USDC', reason: 'load' });
    check('re-using an external id with another payee is refused under load too', dup.status === 409);

    console.log(`D. ${N_READ} reads at concurrency ${CONC}`);
    const reads = await pool(N_READ, CONC, () => timed('GET', '/assets'));
    console.log(`  ${stats(reads.map((r) => r.ms))}`);
    check('no read failed', reads.every((r) => r.status === 200));
    check('p95 read latency under 500ms', pct(reads.map((r) => r.ms), .95) < 500);

    const errs = fs.readFileSync(`${GW}/.load-gateway.log`, 'utf8').split('\n').filter((l) => /"level":50|unhandled|ECONNREFUSED|FATAL/i.test(l));
    check('the gateway logged no errors or crashes during the run', errs.length === 0, errs[0]?.slice(0, 200));
    const rss = Number((await db.query(`SELECT count(*) c FROM pg_stat_activity WHERE datname = $1`, [DB])).rows[0].c);
    console.log(`  database connections open: ${rss}`);
  } finally {
    stop();
    await db.end().catch(() => {});
  }

  console.log('E. The rate limit limits (second gateway, limit 50/min)');
  const log2 = fs.openSync(`${GW}/.load-gateway2.log`, 'w');
  const gw2 = spawn(path.join(GW, 'node_modules/.bin/tsx'), ['src/index.ts'], { cwd: GW, stdio: ['ignore', log2, log2],
    env: { ...process.env, NODE_ENV: 'development', PORT: String(PORT + 1), POSTGRES_HOST: PG.host, POSTGRES_DB: DB, POSTGRES_USER: PG.user, POSTGRES_PASSWORD: PG.password, INTERNAL_WEBHOOK_SECRET: 'load', BASE_RPC_URL: RPC, BASE_CHAIN_ID: '1337', DEPOSIT_MONITOR_CHAINS: 'base', ASSETS_ENABLED: 'USDC', ASSET_USDC_BASE: await usdc.getAddress(), ASSET_USDC_ETHEREUM: 'off', ASSET_USDC_POLYGON: 'off', ASSET_USDC_ARBITRUM: 'off', RATE_LIMIT_PER_MIN: '50' } });
  try {
    for (let i = 0; i < 120; i++) { if (await fetch(`http://127.0.0.1:${PORT + 1}/healthz`).then((r) => r.ok).catch(() => false)) break; await sleep(500); }
    let limited = 0;
    for (let i = 0; i < 120; i++) { const r = await fetch(`http://127.0.0.1:${PORT + 1}/assets`, { headers: { ...H, 'x-forwarded-for': `10.9.${i}.1` } }); if (r.status === 429) limited++; }
    check('a client sending 120 requests (each with a different forged forwarding header) is limited', limited > 0, `${limited} of 120 refused`);
  } finally { try { gw2.kill('SIGTERM'); } catch {} }

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SCRIPT FAILED:', e.stack || e.message); process.exit(1); });
