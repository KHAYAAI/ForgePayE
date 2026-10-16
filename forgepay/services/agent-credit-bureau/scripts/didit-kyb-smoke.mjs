#!/usr/bin/env node
/**
 * Check, against the REAL Didit API, the HTTP details the bureau's Didit provider (src/kyb-didit.ts) depends on: the paths, the auth
 * header, the field names and the response shapes. Run it once from a machine that can reach Didit, before relying on the provider.
 *
 *   DIDIT_API_KEY=… node scripts/didit-kyb-smoke.mjs --country GB --name "Tesco PLC"
 *   DIDIT_API_KEY=… node scripts/didit-kyb-smoke.mjs --country ZA --name "Naspers" --select      # also pays for ONE lookup
 *
 * By default it only SEARCHES, which is free. `--select` pays for one company (about $2 on the live tier) and only if the search
 * found exactly one candidate. The key is read from the environment, sent only in the request header, and never printed. It warns
 * loudly if the answers look like they came from Didit's sandbox, which calls every name an active company.
 *
 * Exit code 0 means every check passed; 1 means something differs from what the provider expects (and says what).
 */

const BASE = (process.env.DIDIT_BASE_URL ?? 'https://verification.didit.me').replace(/\/+$/, '');
const HEADER = 'x-api-key';
const key = process.env.DIDIT_API_KEY;

function args() {
  const o = {}; const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--select') o.select = true;
    else if (a[i].startsWith('--')) { o[a[i].slice(2)] = a[++i]; }
  }
  return o;
}

const problems = []; const notes = [];
const check = (ok, what) => { if (!ok) problems.push(what); return ok; };

async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { [HEADER]: key, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = undefined; }
  return { status: res.status, json, text };
}

async function main() {
  const o = args();
  if (!key) { console.error('[FAIL] DIDIT_API_KEY is not set (read from the environment only; never put it in a file in the repo)'); process.exit(1); }
  if (!o.country || !(o.name || o.number)) { console.error('[FAIL] --country and --name (or --number) are required'); process.exit(1); }

  const search = await post('/v3/kyb/search/', { country_code: o.country.toUpperCase(), ...(o.number ? { registration_number: o.number } : {}), ...(o.name ? { name: o.name, search_type: 'contains' } : {}) });
  console.log(`search  POST /v3/kyb/search/  -> HTTP ${search.status}`);
  if (!check(search.status >= 200 && search.status < 300, `search answered HTTP ${search.status} (expected 2xx). 401/403 usually means the key or the header name (${HEADER}) is wrong; 404 means the path is.`)) return report();
  const reg = search.json?.kyb_registry;
  check(Array.isArray(reg?.companies), 'search: kyb_registry.companies is not an array');
  check(typeof reg?.search_resolved === 'boolean', 'search: kyb_registry.search_resolved is missing');
  const first = reg?.companies?.[0];
  if (first) {
    for (const f of ['kyb_response_id', 'name', 'registration_number', 'status']) check(typeof first[f] === 'string', `search: candidate field "${f}" is missing or not a string`);
    notes.push(`candidates: ${reg.companies.length}; first: "${first.name}" (${first.registration_number}), status "${first.status}"`);
  } else notes.push('the search returned no candidates (not necessarily a problem)');
  const sandbox = reg?.companies?.some((c) => String(c.kyb_response_id).startsWith('sandbox-') || String(c.registration_number).startsWith('SANDBOX-'));
  if (sandbox) notes.push('WARNING: these answers are from Didit\'s SANDBOX (the handle starts "sandbox-"). Do not use this key in production: the bureau will refuse it there, and the sandbox calls every name an active company.');

  if (o.select) {
    if (!first || reg.companies.length !== 1) problems.push('--select needs exactly one candidate; refine the search (this is the same rule the provider follows)');
    else {
      const sel = await post('/v3/kyb/select/', { kyb_response_id: first.kyb_response_id });
      console.log(`select  POST /v3/kyb/select/  -> HTTP ${sel.status}  (this one is billed on a live key)`);
      if (check(sel.status >= 200 && sel.status < 300, `select answered HTTP ${sel.status}`)) {
        const r = sel.json?.kyb_registry;
        for (const f of ['company_name', 'registration_number', 'registry_status', 'country_code', 'fetch_status']) check(typeof r?.[f] === 'string', `select: field "${f}" is missing or not a string`);
        check(typeof r?.data_resolved === 'boolean', 'select: data_resolved is missing');
        check(typeof r?.is_from_registry === 'boolean', 'select: is_from_registry is missing');
        notes.push(`record: "${r?.company_name}" ${r?.registration_number}, registry_status "${r?.registry_status}", from registry: ${r?.is_from_registry}, resolved: ${r?.data_resolved}`);
        notes.push('The provider treats only registry_status "active" (any case) as verified. If the register uses a different word for active companies, tell us.');
      }
    }
  } else notes.push('select not run (pass --select to pay for one lookup and check the record shape)');
  report();
}

function report() {
  for (const n of notes) console.log('  ' + n);
  if (problems.length) { for (const p of problems) console.error('[FAIL] ' + p); console.error('\nThe provider will not work until these are resolved (src/kyb-didit.ts ENDPOINTS / HEADER).'); process.exit(1); }
  console.log('\nAll checks passed.');
}

main().catch((e) => { console.error('[FAIL] ' + (e?.name === 'TimeoutError' ? 'timed out' : String(e?.message ?? e).slice(0, 160))); process.exit(1); });
