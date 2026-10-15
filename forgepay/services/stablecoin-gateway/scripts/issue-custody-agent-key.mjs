#!/usr/bin/env node
/**
 * Issue a FORGE custody agent key for the stablecoin gateway.
 *
 *   CUSTODY_ADMIN_TOKEN=<admin JWT> node scripts/issue-custody-agent-key.mjs \
 *     --api-url https://custody.example.org --customer-id <uuid> --key-id <custody key id> \
 *     --recipients 0xFurnisherOne,0xFurnisherTwo --per-transfer-zar 5000 --daily-zar 20000 \
 *     --out /secure/path/custody-agent-key
 *
 * Calls POST /organisations/{customerId}/agents. Custody shows the new key exactly once, in that response. This script writes it to
 * --out (created with mode 0600; it refuses to overwrite) and NEVER prints it, so it cannot end up in a terminal log, CI log or chat.
 * Move the file into your secret manager at once and delete it.
 *
 * Safe defaults, each refusable only by an explicit flag:
 *   - a fixed recipient list is required (--recipients); an open list needs --allow-open and is refused by the gateway in production;
 *   - the key expires in 30 days by default and never in more than 90 (--allow-long lifts the cap), so it gets rotated;
 *   - --dry-run validates and prints the request without sending anything or needing a token.
 *
 * The admin token is a custody login JWT for a user who may manage agents. It is read from the environment only (never an argument, which
 * would appear in the process list) and is never printed. Obtain it with POST /v1/auth/login (and /v1/auth/mfa/verify if MFA is on).
 */

import { existsSync, writeFileSync } from 'node:fs';

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const UUID = /^[0-9a-fA-F-]{8,64}$/;

function parseArgs(argv) {
  const out = {}; const flags = new Set(['--dry-run', '--allow-open', '--allow-long', '--help']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    if (flags.has(a)) { out[a.slice(2)] = true; continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = v;
  }
  return out;
}

export function buildRequest(args, env = process.env) {
  const apiUrl = (args['api-url'] ?? env.CUSTODY_API_URL ?? '').replace(/\/+$/, '');
  if (!apiUrl) throw new Error('--api-url (or CUSTODY_API_URL) is required');
  let url;
  try { url = new URL(apiUrl); } catch { throw new Error('--api-url is not a valid URL'); }
  if (url.username || url.password) throw new Error('--api-url must not contain credentials');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('--api-url must be https (plain http is accepted only for localhost)');
  }
  const customerId = args['customer-id']; if (!customerId || !UUID.test(customerId)) throw new Error('--customer-id is required');
  const keyId = args['key-id']; if (!keyId) throw new Error('--key-id (the custody key the agent pays from) is required');
  const out = args.out; if (!out) throw new Error('--out (file to write the key to) is required');

  const tokens = (args.tokens ?? 'USDC').split(',').map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (tokens.length === 0) throw new Error('--tokens must name at least one token');

  let recipients;
  if (args.recipients) {
    recipients = args.recipients.split(',').map((r) => r.trim()).filter(Boolean);
    const bad = recipients.filter((r) => !ADDRESS.test(r));
    if (bad.length > 0) throw new Error(`Not a valid address: ${bad[0]}`);
    recipients = [...new Set(recipients.map((r) => r.toLowerCase()))];
  } else if (!args['allow-open']) {
    throw new Error('--recipients is required: a fixed list means a stolen key cannot pay anyone else. Use --allow-open only if you accept that (the gateway refuses such a key in production).');
  }

  const positive = (name) => {
    const n = Number(args[name]);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number (rand)`);
    return n;
  };
  const perTransferLimitZar = positive('per-transfer-zar');
  const dailyLimitZar = positive('daily-zar');
  if (perTransferLimitZar > dailyLimitZar) throw new Error('--per-transfer-zar cannot exceed --daily-zar');

  const expiresInDays = args['expires-days'] === undefined ? 30 : Number(args['expires-days']);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1) throw new Error('--expires-days must be a whole number of days');
  if (expiresInDays > 90 && !args['allow-long']) throw new Error('--expires-days is capped at 90 so the key gets rotated; pass --allow-long to override deliberately');

  return {
    url: `${apiUrl}/organisations/${encodeURIComponent(customerId)}/agents`,
    out,
    body: {
      name: args.name ?? 'stablecoin-gateway', keyId, allowedTokens: tokens,
      ...(recipients ? { allowedRecipients: recipients } : {}),
      perTransferLimitZar, dailyLimitZar, expiresInDays,
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log('See the header of this file for usage.'); return; }
  const req = buildRequest(args);

  console.log(`Agent "${req.body.name}" on key ${req.body.keyId}:`);
  console.log(`  tokens      : ${req.body.allowedTokens.join(', ')}`);
  console.log(`  recipients  : ${req.body.allowedRecipients ? `fixed list of ${req.body.allowedRecipients.length}` : 'OPEN (any address)'}`);
  console.log(`  limits      : R${req.body.perTransferLimitZar} per payment, R${req.body.dailyLimitZar} per 24h`);
  console.log(`  expires in  : ${req.body.expiresInDays} days`);
  console.log(`  key goes to : ${req.out}`);

  if (args['dry-run']) { console.log('\nDry run: nothing was sent and no file was written.'); return; }

  const token = process.env.CUSTODY_ADMIN_TOKEN;
  if (!token) throw new Error('CUSTODY_ADMIN_TOKEN is not set (a custody admin login JWT; it is read from the environment only)');
  if (existsSync(req.out)) throw new Error(`${req.out} already exists; refusing to overwrite a key file`);

  let res;
  try {
    res = await fetch(req.url, {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(req.body), signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`Could not reach custody: ${err?.name === 'TimeoutError' ? 'timed out' : String(err?.message ?? err).slice(0, 120)}`);
  }
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* not JSON */ }
  if (!res.ok) {
    const m = json?.message; throw new Error(`Custody refused (HTTP ${res.status}): ${Array.isArray(m) ? m.join('; ') : String(m ?? 'no message').slice(0, 200)}`);
  }
  if (typeof json.apiKey !== 'string' || !/^ofb_agent_\S+$/.test(json.apiKey)) {
    throw new Error('Custody accepted the request but returned no agent key. Nothing was written. Check custody before trying again, so you do not leave an unused key behind.');
  }

  writeFileSync(req.out, json.apiKey + '\n', { mode: 0o600, flag: 'wx' });
  console.log(`\nIssued agent ${json.agentId ?? '(id not returned)'}, expires ${json.expiresAt ?? 'unknown'}.`);
  console.log(`The key was written to ${req.out} (owner-only) and NOT printed.`);
  console.log('Next: put it in your secret manager, delete the file, and run `npm run preflight:custody`.');
}

import { fileURLToPath } from 'node:url';
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error('[FAIL] ' + (err?.message ?? err)); process.exit(1); });
}
