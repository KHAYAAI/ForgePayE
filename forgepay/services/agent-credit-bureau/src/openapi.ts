/**
 * The institution-facing API as an OpenAPI 3.0 document, served at GET /v1/openapi.json (public: a prospect reads the contract
 * before they hold a key).
 *
 * Covers what a microfinance institution or other lender/furnisher uses. Operator-only routes (registering and activating
 * institutions, settlement, resolving disputes, manual credit) are deliberately left out and listed in openapi.test.ts, which
 * fails if a route is added to the scope table without being either documented here or consciously left out, and if anything
 * documented here is not a real route.
 */

type Json = Record<string, unknown>;

const err = { description: 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const ok = (description: string, schema?: Json): Json => ({
  description,
  ...(schema ? { content: { 'application/json': { schema } } } : {}),
});
const idParam = (name: string, description: string): Json => ({ name, in: 'path', required: true, description, schema: { type: 'string' } });
const body = (schema: Json): Json => ({ required: true, content: { 'application/json': { schema } } });
const data = (schema: Json = { type: 'object' }): Json => ({ type: 'object', properties: { data: schema } });
const PURPOSE = { type: 'string', enum: ['credit_application', 'account_review', 'employment', 'insurance'] };
const EVENT_TYPES = [
  'payment_on_time', 'payment_late_30', 'payment_late_60', 'payment_late_90', 'default', 'credit_opened', 'credit_closed',
  'hard_inquiry', 'dispute_filed', 'dispute_resolved', 'score_updated', 'sanctions_hit', 'identity_verified',
];

export const openApiDocument = {
  openapi: '3.0.3',
  info: {
    title: 'FORGE Agent Credit Bureau: institution API',
    version: '1',
    description:
      'For lenders and data furnishers (for example microfinance institutions). Report repayments, read scores, pull underwriting reports with consent, ' +
      'raise disputes and manage your own API keys. A new agent starts at 300 (DEEP_SUBPRIME) and earns its range through reported repayments: ' +
      'the score is capped until the equivalent of 12 on-time payments are on file. Send the key as `X-API-Key` or `Authorization: Bearer`. ' +
      'A sandbox runs the same API with free inquiries and test data; it labels itself with `X-Forge-Environment: sandbox`.',
  },
  servers: [{ url: 'https://api.myforgepay.com', description: 'Live' }],
  security: [{ ApiKey: [] }, { Bearer: [] }],
  tags: [
    { name: 'Agents' }, { name: 'Furnishing' }, { name: 'Lending' }, { name: 'Disputes' }, { name: 'Billing' },
    { name: 'Keys' }, { name: 'Public' }, { name: 'Sandbox' },
  ],
  paths: {
    '/health': { get: { tags: ['Public'], summary: 'Liveness, and which environment this is', security: [], responses: { 200: ok('OK') } } },
    '/v1/plans': { get: { tags: ['Public'], summary: 'The price list', security: [], responses: { 200: ok('Plans and per-inquiry pricing') } } },

    '/v1/agents/{agentId}/profile': {
      post: {
        tags: ['Agents'], summary: 'Register an agent', description: 'Scope: ingest_events. The agent starts at 300, DEEP_SUBPRIME, with THIN_FILE.',
        parameters: [idParam('agentId', 'Your identifier for the agent')],
        requestBody: body({ $ref: '#/components/schemas/CreateProfile' }),
        responses: { 201: ok('Created', data()), 400: err, 409: err },
      },
      get: {
        tags: ['Agents'], summary: 'Read an agent profile', description: 'Scope: read_profile.',
        parameters: [idParam('agentId', 'Agent id')], responses: { 200: ok('Profile', data()), 404: err },
      },
    },
    '/v1/agents/{agentId}/score': {
      get: {
        tags: ['Agents'], summary: 'Read the current score', description: 'Scope: pull_scores. Returns score, grade, tier and weighted factors with reason codes.',
        parameters: [idParam('agentId', 'Agent id')], responses: { 200: ok('Score', data()), 404: err },
      },
    },
    '/v1/agents/{agentId}/dual-score': {
      get: {
        tags: ['Agents'], summary: 'Read both scores', description: 'Scope: pull_scores. Mode 1 (credit file) and Mode 2 (on-chain, null when there is no on-chain data), with the gap between them as a confidence signal.',
        parameters: [idParam('agentId', 'Agent id')], responses: { 200: ok('Both scores', data()), 404: err },
      },
    },
    '/v1/agents/{agentId}/history': {
      get: {
        tags: ['Agents'], summary: 'Read the reported events', description: 'Scope: read_profile.',
        parameters: [idParam('agentId', 'Agent id'), { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 200 } }, { name: 'offset', in: 'query', schema: { type: 'integer' } }],
        responses: { 200: ok('Events, newest first'), 404: err },
      },
    },

    '/v1/contributors/{id}/ingest': {
      post: {
        tags: ['Furnishing'], summary: 'Report repayment events in a batch',
        description:
          'Scope: ingest_events. Up to 500 events. `externalId` is yours and unique to you: resending a batch ignores events already received, so retries are safe. ' +
          'You may report only credit you extended yourself; `creditorId` is set for you and a different value is rejected. Quota grows with the data you contribute, up to a daily window cap.',
        parameters: [idParam('id', 'Your institution id')],
        requestBody: body({ $ref: '#/components/schemas/IngestEvents' }),
        responses: { 201: ok('Result of the batch', data({ $ref: '#/components/schemas/IngestResult' })), 400: err, 403: err, 404: err, 429: err },
      },
    },
    '/v1/contributors/{id}/stats': {
      get: {
        tags: ['Furnishing'], summary: 'Your own volume and quota', description: 'Scope: ingest_events.',
        parameters: [idParam('id', 'Your institution id')], responses: { 200: ok('Your record', data()), 403: err },
      },
    },

    '/v1/lender-reports': {
      post: {
        tags: ['Lending'], summary: 'Pull an underwriting report',
        description:
          'Scope: pull_scores. Needs a single-use consent token for this agent, this requestor and this purpose. Records a hard inquiry and charges per pull ' +
          '(or draws on a plan). The report carries a decision (outcome, grade, recommended limit, reason codes), activity, exposure, evidence and disclosures.',
        requestBody: body({ $ref: '#/components/schemas/LenderReportRequest' }),
        responses: { 201: ok('The report', data({ $ref: '#/components/schemas/LenderReport' })), 402: err, 403: err, 404: err },
      },
      get: { tags: ['Lending'], summary: 'List the reports you requested', description: 'Scope: pull_scores.', responses: { 200: ok('Your reports') } },
    },
    '/v1/lender-reports/schema': {
      get: { tags: ['Lending'], summary: 'The reason-code dictionary', description: 'Scope: pull_scores. The vocabulary an automated underwriter needs to read any report.', responses: { 200: ok('Codes and meanings') } },
    },
    '/v1/lender-reports/{reportId}': {
      get: { tags: ['Lending'], summary: 'Fetch a report you requested', description: 'Scope: pull_scores.', parameters: [idParam('reportId', 'Report id')], responses: { 200: ok('The report', data()), 404: err } },
    },
    '/v1/reports': {
      post: {
        tags: ['Lending'], summary: 'Pull the credit file', description: 'Scope: pull_scores. Same consent and charging rules as a lender report; a file-style response.',
        requestBody: body({ $ref: '#/components/schemas/PullReportRequest' }), responses: { 201: ok('The credit file', data()), 402: err, 403: err, 404: err },
      },
    },
    '/v1/reports/{reportId}': {
      get: { tags: ['Lending'], summary: 'Fetch a credit file you pulled', description: 'Scope: pull_scores.', parameters: [idParam('reportId', 'Report id')], responses: { 200: ok('The file', data()), 404: err } },
    },

    '/v1/agents/{agentId}/disputes': {
      post: {
        tags: ['Disputes'], summary: 'Dispute a reported event', description: 'Scope: read_profile. The bureau investigates and resolves; the furnisher is derived from the event, not named by the filer.',
        parameters: [idParam('agentId', 'Agent id')], requestBody: body({ $ref: '#/components/schemas/FileDispute' }),
        responses: { 201: ok('Dispute opened', data()), 400: err, 404: err },
      },
      get: { tags: ['Disputes'], summary: 'List disputes on an agent', description: 'Scope: read_profile.', parameters: [idParam('agentId', 'Agent id')], responses: { 200: ok('Disputes') } },
    },

    '/v1/billing/{requestorId}/account': {
      get: { tags: ['Billing'], summary: 'Your prepaid balance and pulls remaining', description: 'Scope: pull_scores. You may read only your own.', parameters: [idParam('requestorId', 'Your institution id')], responses: { 200: ok('Account', data()), 403: err } },
    },
    '/v1/billing/{requestorId}/transactions': {
      get: { tags: ['Billing'], summary: 'Your ledger', description: 'Scope: pull_scores.', parameters: [idParam('requestorId', 'Your institution id')], responses: { 200: ok('Ledger entries'), 403: err } },
    },
    '/v1/billing/{requestorId}/topup': {
      post: {
        tags: ['Billing'], summary: 'Start a top-up in a stablecoin', description: 'Scope: pull_scores. Returns payment instructions; confirm once paid.',
        parameters: [idParam('requestorId', 'Your institution id')], requestBody: body({ $ref: '#/components/schemas/TopUp' }), responses: { 201: ok('Payment instructions', data()), 403: err, 503: err },
      },
    },
    '/v1/billing/{requestorId}/topup/{receiptId}/confirm': {
      post: {
        tags: ['Billing'], summary: 'Confirm a top-up after paying', description: 'Scope: pull_scores.',
        parameters: [idParam('requestorId', 'Your institution id'), idParam('receiptId', 'Receipt id from the top-up')], responses: { 200: ok('Credited', data()), 403: err, 404: err },
      },
    },

    '/v1/contributors/{id}/keys': {
      get: { tags: ['Keys'], summary: 'List your API keys (never key material)', description: 'Any active institution key. You may manage only your own.', parameters: [idParam('id', 'Your institution id')], responses: { 200: ok('Keys', data()), 403: err } },
      post: {
        tags: ['Keys'], summary: 'Issue a new key', description: 'The key is shown once. Up to 5 active keys, so you can rotate with no downtime: issue, move over, revoke the old.',
        parameters: [idParam('id', 'Your institution id')], requestBody: body({ $ref: '#/components/schemas/IssueKey' }), responses: { 201: ok('The new key, shown once', data()), 409: err },
      },
    },
    '/v1/contributors/{id}/keys/{keyId}': {
      delete: {
        tags: ['Keys'], summary: 'Revoke a key', description: 'Effective on the next request. Your registration key is `primary`. You cannot revoke your only active key; an operator can.',
        parameters: [idParam('id', 'Your institution id'), idParam('keyId', 'Key id, or `primary`')], responses: { 200: ok('Revoked', data()), 404: err, 409: err },
      },
    },

    '/v1/sandbox/consent': {
      post: {
        tags: ['Sandbox'], summary: 'Sandbox only: issue yourself a consent token for a test agent',
        description: 'Exists only in the sandbox. In the live service the agent\'s operator authorises each pull.',
        requestBody: body({ type: 'object', required: ['agentId'], properties: { agentId: { type: 'string' }, purpose: PURPOSE } }),
        responses: { 201: ok('A single-use consent token', data()), 403: err, 404: err },
      },
    },
  },
  components: {
    securitySchemes: {
      ApiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      Bearer: { type: 'http', scheme: 'bearer' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' }, details: { type: 'object' } } },
      CreateProfile: {
        type: 'object', required: ['agentId', 'did', 'operatorEntityId', 'operatorEntityType'],
        properties: {
          agentId: { type: 'string' }, did: { type: 'string', example: 'did:forge:agent_acme_1', description: 'did:forge:agent_<id> or did:forge:0x<address>' },
          evmAddress: { type: 'string' }, operatorEntityId: { type: 'string' },
          operatorEntityType: { type: 'string', enum: ['individual', 'llc', 'corp', 'dao'] },
          operatorLegalName: { type: 'string' }, operatorCountry: { type: 'string', example: 'ZA' }, operatorRegistrationNumber: { type: 'string' },
        },
      },
      IngestEvents: {
        type: 'object', required: ['agentId', 'events'],
        properties: {
          agentId: { type: 'string' },
          events: {
            type: 'array', minItems: 1, maxItems: 500,
            items: {
              type: 'object', required: ['externalId', 'eventType', 'description'],
              properties: {
                externalId: { type: 'string', description: 'Your own unique id for this event; makes retries safe' },
                eventType: { type: 'string', enum: EVENT_TYPES }, amount: { type: 'number', minimum: 0 },
                description: { type: 'string' }, onChainTxHash: { type: 'string' },
              },
            },
          },
        },
      },
      IngestResult: {
        type: 'object',
        properties: { ingestedCount: { type: 'integer' }, duplicatesIgnored: { type: 'integer' }, creditedToQuota: { type: 'integer' }, windowCapped: { type: 'boolean' }, newScore: { type: 'integer' } },
      },
      LenderReportRequest: {
        type: 'object', required: ['agentId', 'requestorId', 'requestorName', 'purpose', 'consentToken'],
        properties: { agentId: { type: 'string' }, requestorId: { type: 'string', description: 'Your institution id' }, requestorName: { type: 'string' }, purpose: PURPOSE, consentToken: { type: 'string' } },
      },
      PullReportRequest: {
        type: 'object', required: ['requestorId', 'requestorName', 'agentId', 'purpose', 'consentToken'],
        properties: { requestorId: { type: 'string' }, requestorName: { type: 'string' }, agentId: { type: 'string' }, purpose: PURPOSE, consentToken: { type: 'string' }, zkProofMode: { type: 'boolean', default: false } },
      },
      LenderReport: {
        type: 'object',
        properties: {
          reportId: { type: 'string' }, schemaVersion: { type: 'string', example: 'forge.lender-report.v1' }, agentId: { type: 'string' },
          decision: { type: 'object', description: 'outcome, score, tier, grade, maxRecommendedLimitUsd, confidence, reasonCodes[]' },
          activity: { type: 'object' }, exposure: { type: 'object' }, evidence: { type: 'object' }, narrative: { type: 'string' }, disclosures: { type: 'object' },
        },
      },
      FileDispute: {
        type: 'object', required: ['eventId', 'description'],
        properties: { eventId: { type: 'string' }, description: { type: 'string', minLength: 10 }, evidence: { type: 'string' } },
      },
      TopUp: { type: 'object', required: ['amountUsd'], properties: { amountUsd: { type: 'number', maximum: 10000 }, asset: { type: 'string', enum: ['USDC', 'ZARP', 'OUSD'] } } },
      IssueKey: { type: 'object', properties: { label: { type: 'string', maxLength: 80 }, expiresInDays: { type: 'integer', minimum: 1, maximum: 730 } } },
    },
  },
} as const;

/** Methods and paths documented above, as "METHOD /v1/path/:param" keys (the form the scope table uses). */
export function documentedRoutes(): string[] {
  const out: string[] = [];
  for (const [path, item] of Object.entries(openApiDocument.paths)) {
    for (const method of Object.keys(item)) out.push(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ':$1')}`);
  }
  return out;
}
