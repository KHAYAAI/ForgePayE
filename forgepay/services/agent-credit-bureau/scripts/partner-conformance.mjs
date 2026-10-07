#!/usr/bin/env node
/**
 * Partner conformance check: does your integration with the FORGE credit bureau behave the way the API says?
 *
 * It runs against a SANDBOX only, and refuses to run against a live service: it writes test agents and test payment events.
 * Needs Node 18+ and no packages.
 *
 *   node scripts/partner-conformance.mjs --base-url https://sandbox.example.com --key ck_... --institution-id <your id>
 *
 * Your key needs these scopes: ingest_events, pull_scores, read_profile.
 * Exit code 0 means every check passed.
 */

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));

const BASE = (args['base-url'] || process.env.BUREAU_BASE_URL || '').replace(/\/$/, '');
const KEY = args.key || process.env.BUREAU_API_KEY;
const INST = args['institution-id'] || process.env.BUREAU_INSTITUTION_ID;
if (!BASE || !KEY || !INST) {
  console.error('Usage: node scripts/partner-conformance.mjs --base-url <url> --key <api key> --institution-id <id>');
  process.exit(2);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  -> ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function call(method, path, { key = KEY, body } = {}) {
  const headers = {};
  if (key) headers['x-api-key'] = key;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, json, headers: res.headers };
}

const run = Date.now().toString(36);
const agentId = `conformance_${run}`;

// 0. Where are we? Never write test data to a live service.
const health = await call('GET', '/health', { key: null });
if (health.json?.environment !== 'sandbox') {
  console.error(`Refusing to run: ${BASE} reports environment "${health.json?.environment ?? 'unknown'}", not "sandbox". This script writes test data.`);
  process.exit(2);
}
check('the service identifies itself as a sandbox', health.headers.get('x-forge-environment') === 'sandbox');

// 1. Public and auth basics
check('the price list is public', (await call('GET', '/v1/plans', { key: null })).status === 200);
check('a request with no key is refused (401)', (await call('GET', `/v1/agents/${agentId}/score`, { key: null })).status === 401);
check('a wrong key is refused (401)', (await call('GET', `/v1/agents/${agentId}/score`, { key: 'ck_wrong' })).status === 401);

// 2. Register an agent: it must start at the bottom
const reg = await call('POST', `/v1/agents/${agentId}/profile`, {
  body: {
    agentId, did: `did:forge:agent_${agentId}`, operatorEntityId: `op_${agentId}`, operatorEntityType: 'llc',
    operatorLegalName: 'Conformance Test Operator (Pty) Ltd', operatorCountry: 'ZA',
  },
});
check('registering an agent returns 201', reg.status === 201, `got ${reg.status}`);
check('a new agent starts at 300, DEEP_SUBPRIME', reg.json?.data?.currentScore === 300 && reg.json?.data?.tier === 'DEEP_SUBPRIME');
check('a new agent shows THIN_FILE', (reg.json?.data?.scoreFactors ?? []).some((f) => f.code === 'THIN_FILE'));
check('registering the same agent again is refused (409)', (await call('POST', `/v1/agents/${agentId}/profile`, { body: reg.json?.data ? { ...reg.json.data, agentId } : {} })).status === 409);

// 3. Report repayments: batch, idempotent
const events = [
  { externalId: `${run}-1`, eventType: 'payment_on_time', amount: 100, description: 'instalment 1' },
  { externalId: `${run}-2`, eventType: 'payment_on_time', amount: 100, description: 'instalment 2' },
  { externalId: `${run}-3`, eventType: 'payment_on_time', amount: 100, description: 'instalment 3' },
];
const ingest = await call('POST', `/v1/contributors/${INST}/ingest`, { body: { agentId, events } });
check('reporting three repayments returns 201', ingest.status === 201, `got ${ingest.status} ${JSON.stringify(ingest.json)?.slice(0, 120)}`);
check('all three were accepted', ingest.json?.data?.ingestedCount === 3);
check('the score rose from the floor', (ingest.json?.data?.newScore ?? 0) > 300);
const again = await call('POST', `/v1/contributors/${INST}/ingest`, { body: { agentId, events } });
check('resending the same batch is idempotent (nothing written twice)', again.json?.data?.ingestedCount === 0 && again.json?.data?.duplicatesIgnored === 3);
const bad = await call('POST', `/v1/contributors/${INST}/ingest`, { body: { agentId, events: [{ externalId: `${run}-x`, eventType: 'nonsense', description: 'd' }] } });
check('an unknown event type is rejected (400)', bad.status === 400);
const impostor = await call('POST', `/v1/contributors/${INST}/ingest`, { body: { agentId, events: [{ externalId: `${run}-y`, eventType: 'payment_on_time', description: 'd', creditorId: 'someone_else' }] } });
check('attributing credit to another institution is rejected (400)', impostor.status === 400);
check('reporting as a different institution id is refused (403)', (await call('POST', '/v1/contributors/not-my-id/ingest', { body: { agentId, events } })).status === 403);

// 4. Read the score
const score = await call('GET', `/v1/agents/${agentId}/score`);
check('the score can be read', score.status === 200 && typeof score.json?.data?.score === 'number');
check('the score matches what the report said', score.json?.data?.score === ingest.json?.data?.newScore);
check('the score is capped until enough repayments are on file', (score.json?.data?.factors ?? []).some((f) => f.code === 'LIMITED_REPAYMENT_HISTORY'));

// 5. The lender flow: consent, then an underwriting report
const consent = await call('POST', '/v1/sandbox/consent', { body: { agentId, purpose: 'credit_application' } });
check('a consent token can be obtained in the sandbox', consent.status === 201 && !!consent.json?.data?.consentToken, `got ${consent.status}`);
const token = consent.json?.data?.consentToken;
const reportBody = { agentId, requestorId: INST, requestorName: 'Conformance Lender', purpose: 'credit_application', consentToken: token };
const report = await call('POST', '/v1/lender-reports', { body: reportBody });
check('a lender report is returned', report.status < 300 && !!report.json?.data?.reportId, `got ${report.status}`);
check('the report carries a decision with an outcome', typeof report.json?.data?.decision?.outcome === 'string');
check('the decision cites reason codes', (report.json?.data?.decision?.reasonCodes ?? []).length > 0);
check('the report states its schema version', typeof report.json?.data?.schemaVersion === 'string');
const reuse = await call('POST', '/v1/lender-reports', { body: reportBody });
check('a consent token cannot be used twice', reuse.status >= 400, `got ${reuse.status}`);
check('the reason-code dictionary is available', (await call('GET', '/v1/lender-reports/schema')).status === 200);

// 6. Disputes
const history = await call('GET', `/v1/agents/${agentId}/history`);
const eventId = history.json?.data?.[0]?.id;
const dispute = await call('POST', `/v1/agents/${agentId}/disputes`, { body: { eventId, description: 'Conformance test dispute: please ignore.' } });
check('a dispute can be filed against a reported event', dispute.status === 201, `got ${dispute.status}`);

// 7. Key rotation without downtime
const issued = await call('POST', `/v1/contributors/${INST}/keys`, { body: { label: `conformance-${run}`, expiresInDays: 1 } });
check('a second key can be issued', issued.status === 201 && !!issued.json?.data?.apiKey, `got ${issued.status}`);
const newKey = issued.json?.data?.apiKey;
const newKeyId = issued.json?.data?.key?.id;
check('the new key works at once', (await call('GET', `/v1/contributors/${INST}/keys`, { key: newKey })).status === 200);
check('the key list never shows key material', !JSON.stringify((await call('GET', `/v1/contributors/${INST}/keys`)).json).includes(newKey ?? 'x'));
check('the new key can be revoked', (await call('DELETE', `/v1/contributors/${INST}/keys/${newKeyId}`)).status === 200);
check('a revoked key is refused (401)', (await call('GET', `/v1/contributors/${INST}/keys`, { key: newKey })).status === 401);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
