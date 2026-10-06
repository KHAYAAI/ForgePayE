#!/usr/bin/env node
// Checks a filled-in launch env file (or the current environment) against what the bureau and console
// require in production. It prints which setting is wrong, never the value of a secret.
//   node preflight.mjs /path/to/launch.env
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const env = { ...process.env };
if (file) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*([^#]*?)\s*(?:#.*)?$/);
    if (m) env[m[1]] = m[2];
  }
}

const problems = [];
const warnings = [];
const need = (k, why) => { if (!env[k]) problems.push(`${k} is not set: ${why}`); return env[k] ?? ''; };
const DEV = /^(dev-|devpassword|changeme|password|secret)/i;
const secret = (k, why) => {
  const v = need(k, why);
  if (v && v.length < 32) problems.push(`${k} is shorter than 32 characters`);
  if (v && DEV.test(v)) problems.push(`${k} still holds a development value`);
  return v;
};

if (env.NODE_ENV !== 'production') problems.push('NODE_ENV must be production');
secret('BUREAU_ADMIN_API_KEY', 'operator key, same value on the bureau and the console');
secret('CONSENT_SIGNING_SECRET', 'signs consent tokens');
secret('JWT_SECRET', 'signs console sessions');
secret('INTERNAL_WEBHOOK_SECRET', 'console to router calls');
need('DATABASE_URL', 'the bureau refuses to boot without persistence');
need('COMPLIANCE_MONITOR_URL', 'sanctions screening fails closed without it');
need('AGENT_CREDIT_BUREAU_URL', 'where the console reaches the bureau');
need('FORGE_OPERATOR_TENANT_ID', 'without it no workspace can see the whole register or resolve disputes');
const cors = need('CORS_ORIGIN', 'must be an explicit allowlist');
if (cors === '*') problems.push('CORS_ORIGIN must not be *');
if (!env.REDIS_URL) warnings.push('REDIS_URL is not set: rate limits are per replica');
if (!env.ZA_TFS_URL) problems.push('ZA_TFS_URL is not set: production screening will refuse to clear anyone');
if ((env.FORGE_LAUNCHED_PRODUCTS ?? 'credit-bureau') !== 'credit-bureau') {
  problems.push(`FORGE_LAUNCHED_PRODUCTS is "${env.FORGE_LAUNCHED_PRODUCTS}": only credit-bureau is cleared to launch`);
}
if (!env.TRUST_PROXY_HOPS) warnings.push('TRUST_PROXY_HOPS is not set: client IPs for rate limits and audit will be the proxy');
if (env.ZK_STUB_PROOFS_ACKNOWLEDGED === 'true') warnings.push('ZK_STUB_PROOFS_ACKNOWLEDGED=true serves a stub, not a cryptographic proof');
const keys = ['BUREAU_ADMIN_API_KEY', 'CONSENT_SIGNING_SECRET', 'JWT_SECRET', 'INTERNAL_WEBHOOK_SECRET'].map((k) => env[k]).filter(Boolean);
if (new Set(keys).size !== keys.length) problems.push('two secrets share the same value; each must be generated separately');

for (const w of warnings) console.log(`warn  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
console.log(problems.length ? `\n${problems.length} problem(s). Not ready.` : '\nAll required settings present.');
process.exit(problems.length ? 1 : 0);
