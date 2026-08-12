/**
 * ForgePay Agent Credit Bureau
 * ─────────────────────────────────────────────────────────────────────────────
 * Role: World's first credit bureau for autonomous AI agents — FICO-style scoring
 *       (0-1000), identity binding, dispute management, and lender APIs.
 *
 * Features:
 *   1. Deterministic Credit Scoring     — 5-component FICO-style model
 *   2. Agent Identity Binding           — DID → legal entity (EIN/VAT)
 *   3. Dispute Management               — 30-day FCRA-compliant resolution
 *   4. Credit Report API                — Lender-facing, consent-gated
 *   5. ZK Proof Generation              — Privacy-preserving claims
 *   6. Data Contributor Onboarding      — External protocol data ingestion
 *   7. Billing                          — prepaid ledger, x402 USDC top-up
 *
 * Port: 3018
 *
 * Env vars:
 *   AGENT_IDENTITY_URL     — default http://localhost:3010
 *   AGENT_DECISION_URL     — default http://localhost:3013
 *   CORS_ORIGIN            — default *
 *   RATE_LIMIT_PER_MIN     — default 100
 *   LOG_LEVEL              — default info
 *   STABLECOIN_GATEWAY_URL — x402 top-up rail; unset disables top-ups (see billing.ts)
 *   BUREAU_X402_MERCHANT_ID — default forgepay-credit-bureau
 */

import Fastify, { FastifyError } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import helmet from '@fastify/helmet';
import { z } from 'zod';
import { randomUUID, randomBytes } from 'crypto';
import { registerAuth, hashApiKey, redactContributor, contributorAccessError } from './auth';
import { isValidDid, isAddressBody, addressFromDid, toChecksumAddress, sameAddress } from './did';
import { issueConsent, verifyConsent, revokeConsent, consumeConsent, type ConsentPurpose } from './consent';
import { resolveDispute, withEscalationCheck, furnisherForEvent, type DisputeCorrection } from './disputes';
import {
  getAccountSummary, creditAccount, chargeInquiryFee, billingHistory,
  requestTopUp, confirmTopUp, centsToUsd, usdToCents,
} from './billing';

import {
  getProfile, setProfile, getDispute, setDispute,
  getReport, setReport, getContributor, setContributor, listDisputes,
  listProfiles, bureauStats, profiles, contributors, initPersistence, deriveScoreFields,
  getLenderReport, setLenderReport, listLenderReports,
} from './store';
import {
  buildLenderReport, renderLenderReportMarkdown,
  REASON_CODE_CATALOG, LENDER_REPORT_SCHEMA_VERSION,
  type LenderReportPurpose,
} from './lender-report';
import {
  computeScore, scoreTier, generateZKProof,
  maxRecommendedLimit, scoreRecommendation, simulateScore,
  computeDualModeScore, computePaymentHistoryRate,
} from './scorer';
import type {
  AgentCreditProfile, CreditReport, Dispute, CreditEvent,
} from './types';
import { creditGrade, GRADE_SCALE, INQUIRY_FEE_USD } from './grade';
import { verifyAgent, sanctionsScreen } from './verify';
import { getChainClient, didToAddress } from './chain';
import {
  runSettlement, startSettlementScheduler, hydrateSettlements,
  getLastSettlementRun, getSettlementReceipt, getSettlementRunCount,
  settlementEligibility,
} from './settlement';

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT               = parseInt(process.env['PORT'] ?? '3018', 10);
const AGENT_IDENTITY_URL = process.env['AGENT_IDENTITY_URL'] ?? 'http://localhost:3010';
const RATE_LIMIT_PER_MIN = parseInt(process.env['RATE_LIMIT_PER_MIN'] ?? '100', 10);

// ── Zod schemas ───────────────────────────────────────────────────────────────

const CreateProfileSchema = z.object({
  agentId:             z.string().min(1),
  // Was `z.string().min(1)`, so `"x"` was accepted and the profile created
  // silently un-settleable — the format only failed later, inside a settlement
  // run's error array. Reject at the boundary instead.
  did:                 z.string().refine(isValidDid, {
    message: 'Must be a DID of the form did:forge:0x<40 hex> or did:forge:agent_<id> ' +
             '(did:fp: and did:forgepay: are accepted as legacy aliases)',
  }),
  // Optional because a registry-form DID carries no address. Required in
  // practice for an agent that intends to settle on-chain.
  evmAddress:          z.string().refine(isAddressBody, {
    message: 'Must be a 20-byte hex EVM address (0x + 40 hex characters)',
  }).optional(),
  operatorEntityId:    z.string().min(1),
  operatorEntityType:  z.enum(['individual', 'llc', 'corp', 'dao']),
  // Optional: an EIN/VAT/TRN isn't itself matchable against a sanctions list,
  // which screens by name. Without this, sanctionsScreen() can only run its
  // address check (if evmAddress is set) or falls back to local-only.
  operatorLegalName:   z.string().min(1).max(300).optional(),
});

const RecordEventSchema = z.object({
  eventType:     z.enum([
    'payment_on_time', 'payment_late_30', 'payment_late_60', 'payment_late_90',
    'default', 'credit_opened', 'credit_closed', 'hard_inquiry',
    'dispute_filed', 'dispute_resolved', 'score_updated', 'sanctions_hit', 'identity_verified',
  ]),
  amount:        z.number().nonnegative().optional(),
  creditorId:    z.string().optional(),
  description:   z.string().min(1),
  onChainTxHash: z.string().optional(),
  proofId:       z.string().optional(),
});

const PullReportSchema = z.object({
  requestorId:   z.string().min(1),
  requestorName: z.string().min(1),
  agentId:       z.string().min(1),
  purpose:       z.enum(['credit_application', 'account_review', 'employment', 'insurance']),
  consentToken:  z.string().min(1),
  zkProofMode:   z.boolean().default(false),
});

/**
 * A lender report pull. Same authorisation contract as `PullReportSchema` —
 * consent-gated, records a hard inquiry — because it releases the same
 * underlying credit data in a different shape. `zkProofMode` is deliberately
 * absent: an underwriting packet whose whole purpose is to be auditable by a
 * credit committee cannot also be a privacy-redacted proof bundle.
 */
const LenderReportSchema = z.object({
  agentId:       z.string().min(1),
  requestorId:   z.string().min(1),
  requestorName: z.string().min(1),
  purpose:       z.enum(['credit_application', 'account_review', 'employment', 'insurance']),
  consentToken:  z.string().min(1),
});

const FileDisputeSchema = z.object({
  eventId:     z.string().min(1),
  description: z.string().min(10),
  evidence:    z.string().optional(),
  // Accepted for backward compatibility, but not authoritative — the handler
  // derives the true furnisher from the disputed event's contributorId and
  // rejects a value that contradicts it, the same rule ingest applies to
  // creditorId. A filer should not be able to name who they're accusing.
  furnisherId: z.string().optional(),
});

const DisputeCorrectionSchema = z.object({
  eventType:   RecordEventSchema.shape.eventType.optional(),
  amount:      z.number().nonnegative().optional(),
  description: z.string().min(1).optional(),
});

const UpdateDisputeSchema = z.object({
  status:     z.enum(['investigating', 'resolved_upheld', 'resolved_corrected', 'resolved_deleted']),
  resolution: z.string().min(1).max(2000).optional(),
  // Required by the handler when status is resolved_corrected — an arbitrator
  // must state what the correct facts are, not just that the original record
  // was wrong. Validated here as optional so the more specific error from
  // resolveDispute() (correction_required) fires instead of a generic 400.
  correction: DisputeCorrectionSchema.optional(),
});

/**
 * Ingest requires an `externalId` per event — the furnisher's own identifier,
 * unique to that furnisher. It makes a retried batch idempotent, replacing a
 * server-generated `proofId: randomUUID()` that identified nothing.
 */
const IngestEventSchema = RecordEventSchema.extend({
  externalId: z.string().min(1).max(200),
});

const IngestEventsSchema = z.object({
  agentId: z.string().min(1),
  events:  z.array(IngestEventSchema).min(1).max(500),
});

/** Rolling window for contribution-driven quota growth. */
const INGEST_WINDOW_MS  = 24 * 60 * 60 * 1000;
const INGEST_WINDOW_CAP = parseInt(process.env['INGEST_WINDOW_CAP'] ?? '10000', 10);

const RegisterContributorSchema = z.object({
  name:        z.string().min(1),
  type:        z.enum(['defi_protocol', 'cefi_lender', 'saas_platform', 'bank', 'forgepay_internal']),
  permissions: z.array(z.string()).default(['ingest_events']),
});

const ContributorStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'pending']),
  reason: z.string().min(1).max(500),
});

const IssueConsentSchema = z.object({
  agentId:     z.string().min(1),
  requestorId: z.string().min(1),
  purpose:     z.enum(['credit_application', 'account_review', 'employment', 'insurance']),
  ttlSeconds:  z.number().int().positive().max(86_400).optional(),
});

const RevokeConsentSchema = z.object({
  jti: z.string().min(1),
  exp: z.number().int().positive(),
});

const TopUpSchema = z.object({
  amountUsd: z.number().positive().max(10_000),
});

const AdminCreditSchema = z.object({
  amountUsd: z.number().positive().max(1_000_000),
  reason:    z.string().min(1).max(300),
});

const ZKProofRequestSchema = z.object({
  circuit: z.enum(['score_above', 'no_default_last_n_months', 'debt_under', 'utilization_below']),
  params:  z.record(z.number()),
});

const SimulateSchema = z.object({
  action: z.enum(['pay_down_debt', 'increase_limit', 'on_time_payments', 'resolve_delinquency']),
  params: z.record(z.number()).default({}),
});

// ── App builder ───────────────────────────────────────────────────────────────

async function buildApp() {
  const app = Fastify({
    logger:     { level: process.env['LOG_LEVEL'] ?? 'info' },
    trustProxy: true,
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin:  process.env['CORS_ORIGIN'] ?? '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    max:        RATE_LIMIT_PER_MIN,
    timeWindow: '1 minute',
    keyGenerator: (req) =>
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, ctx) => ({
      statusCode: 429,
      error:      'Too Many Requests',
      message:    `Rate limit exceeded. Retry in ${Math.ceil(ctx.ttl / 1000)}s`,
    }),
  });

  // Authorisation — registered after the rate limiter, so a flood of
  // unauthenticated requests is shed before it reaches key comparison, and
  // ahead of every route, so nothing is served without a credential.
  // Deny-by-default: a route absent from the scope table requires `admin`.
  registerAuth(app);

  // ── Health probe ───────────────────────────────────────────────────────────
  app.get('/health', async () => ({
    status:          'ok',
    service:         'agent-credit-bureau',
    version:         '0.1.0',
    port:            PORT,
    agentIdentityUrl: AGENT_IDENTITY_URL,
    registeredAgents: profiles.size,
    timestamp:       new Date().toISOString(),
  }));

  // ── Prometheus metrics ─────────────────────────────────────────────────────
  app.get('/metrics', async (_req, reply) => {
    const stats = bureauStats();
    const lines = [
      '# HELP bureau_agents_total Total registered agent profiles',
      '# TYPE bureau_agents_total gauge',
      `bureau_agents_total ${stats.totalAgents}`,
      '# HELP bureau_avg_score Average credit score across all agents',
      '# TYPE bureau_avg_score gauge',
      `bureau_avg_score ${stats.avgScore}`,
      '# HELP bureau_total_debt_usd Total outstanding debt in USD',
      '# TYPE bureau_total_debt_usd gauge',
      `bureau_total_debt_usd ${stats.totalDebt}`,
      '# HELP bureau_open_disputes Open dispute count',
      '# TYPE bureau_open_disputes gauge',
      `bureau_open_disputes ${stats.openDisputes}`,
    ];
    reply.type('text/plain; version=0.0.4; charset=utf-8').send(lines.join('\n') + '\n');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Credit Profile — Agent-facing
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /v1/agents/:agentId/profile
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/profile', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: `Agent ${req.params.agentId} not registered` });
    return reply.send({ data: profile });
  });

  // POST /v1/agents/:agentId/profile — create profile
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/profile', async (req, reply) => {
    const parse = CreateProfileSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    if (getProfile(req.params.agentId)) {
      return reply.status(409).send({ error: 'Conflict', message: `Agent ${req.params.agentId} already has a profile` });
    }

    // An explicit address wins; otherwise fall back to a self-certifying DID.
    // A registry-form DID with no address is allowed through — the profile is
    // simply not settlement-eligible, and says so rather than failing silently.
    const derivedAddress = addressFromDid(parse.data.did);
    const evmAddress = parse.data.evmAddress
      ? toChecksumAddress(parse.data.evmAddress)
      : derivedAddress ?? undefined;

    if (parse.data.evmAddress && derivedAddress && !sameAddress(parse.data.evmAddress, derivedAddress)) {
      return reply.status(400).send({
        error: 'ValidationError',
        message: `evmAddress ${evmAddress} contradicts the address in the DID (${derivedAddress}).`,
      });
    }

    const now = new Date().toISOString();
    const profile: AgentCreditProfile = {
      agentId:             req.params.agentId,
      did:                 parse.data.did,
      evmAddress,
      operatorEntityId:    parse.data.operatorEntityId,
      operatorEntityType:  parse.data.operatorEntityType,
      operatorLegalName:   parse.data.operatorLegalName,
      currentScore:        650, // initial neutral score
      tier:                'PRIME',
      scoreFactors:        [],
      creditHistory:       [],
      totalDebt:           0,
      totalCreditLimit:    0,
      utilizationRate:     0,
      paymentHistoryRate:  1.0,
      delinquencies:       [],
      hardInquiries:       [],
      createdAt:           now,
      lastUpdatedAt:       now,
    };

    const { score, factors } = computeScore(profile);
    profile.currentScore  = score;
    profile.tier          = scoreTier(score);
    profile.scoreFactors  = factors;

    setProfile(profile);
    return reply.status(201).send({ data: profile });
  });

  // GET /v1/agents/:agentId/score
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/score', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: `Agent ${req.params.agentId} not found` });
    return reply.send({
      data: {
        agentId:      profile.agentId,
        score:        profile.currentScore,
        tier:         profile.tier,
        grade:        creditGrade(profile.currentScore),
        factors:      profile.scoreFactors,
        utilization:  profile.utilizationRate,
        paymentRate:  profile.paymentHistoryRate,
        lastUpdated:  profile.lastUpdatedAt,
        frozen:       !!profile.frozenAt,
      },
    });
  });

  // GET /v1/agents/:agentId/history
  app.get<{ Params: { agentId: string }; Querystring: { limit?: string; offset?: string } }>(
    '/v1/agents/:agentId/history', async (req, reply) => {
      const profile = getProfile(req.params.agentId);
      if (!profile) return reply.status(404).send({ error: 'NotFound', message: 'Agent not found' });

      const limit  = Math.min(parseInt((req.query as { limit?: string }).limit ?? '20', 10), 200);
      const offset = parseInt((req.query as { offset?: string }).offset ?? '0', 10);
      const history = [...profile.creditHistory]
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
        .slice(offset, offset + limit);

      return reply.send({ data: history, total: profile.creditHistory.length });
    },
  );

  // POST /v1/agents/:agentId/simulate
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/simulate', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: 'Agent not found' });

    const parse = SimulateSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const { action, params } = parse.data;
    const newScore = simulateScore(profile, action, params);

    return reply.send({
      data: {
        agentId:      profile.agentId,
        currentScore: profile.currentScore,
        simulatedScore: newScore,
        scoreDelta:   newScore - profile.currentScore,
        action,
        params,
        timeToEffect: '30 days',
      },
    });
  });

  // POST /v1/agents/:agentId/events — record a credit event
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/events', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: 'Agent not found' });

    const parse = RecordEventSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const event: CreditEvent = {
      id:            randomUUID(),
      agentId:       profile.agentId,
      timestamp:     new Date().toISOString(),
      ...parse.data,
    };

    profile.creditHistory.push(event);

    // Update utilization if it's a debt event
    if (event.eventType === 'payment_on_time' && event.amount) {
      profile.totalDebt = Math.max(0, profile.totalDebt - event.amount);
    } else if (event.eventType === 'credit_opened' && event.amount) {
      profile.totalCreditLimit += event.amount;
    } else if (['payment_late_30', 'payment_late_60', 'payment_late_90'].includes(event.eventType)) {
      profile.delinquencies.push({
        id:          randomUUID(),
        creditorId:  event.creditorId ?? 'unknown',
        amount:      event.amount ?? 0,
        daysLate:    event.eventType === 'payment_late_30' ? 30 : event.eventType === 'payment_late_60' ? 60 : 90,
        openedAt:    event.timestamp,
        status:      'open',
      });
    }

    // Recalculate utilization + payment rate
    if (profile.totalCreditLimit > 0) {
      profile.utilizationRate = profile.totalDebt / profile.totalCreditLimit;
    }
    // A default is a fully failed obligation, not merely absent from the
    // "payment" prefix it doesn't share — computePaymentHistoryRate counts it
    // in the denominator so it actually moves this rate instead of leaving an
    // agent with six defaults and zero recorded late payments at a perfect 1.0.
    profile.paymentHistoryRate = computePaymentHistoryRate(profile.creditHistory);

    // Recompute score
    const { score, factors } = computeScore(profile);
    profile.currentScore  = score;
    profile.tier          = scoreTier(score);
    profile.scoreFactors  = factors;
    profile.lastUpdatedAt = new Date().toISOString();

    setProfile(profile);
    return reply.status(201).send({ data: { event, newScore: score, tier: profile.tier } });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Credit Reports — Lender-facing
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /v1/reports — pull a credit report
  // POST /v1/consent — issue a consent token authorising one credit pull.
  //
  // Admin-only for now, which is deliberate and worth being explicit about:
  // consent should be granted by the agent's operator, but there is no
  // agent-authentication path yet — the wallet/DID auth that would let an
  // operator authenticate directly lands in a later phase. Until then the
  // bureau issues on an operator's behalf, and the audit trail records that.
  app.post('/v1/consent', async (req, reply) => {
    const parse = IssueConsentSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    if (!getProfile(parse.data.agentId)) {
      return reply.status(404).send({ error: 'NotFound', message: `Agent ${parse.data.agentId} not found` });
    }

    const { token, payload } = issueConsent({
      agentId:     parse.data.agentId,
      requestorId: parse.data.requestorId,
      purpose:     parse.data.purpose as ConsentPurpose,
      ttlSeconds:  parse.data.ttlSeconds,
    });

    req.log.info(
      { agentId: payload.sub, requestorId: payload.aud, purpose: payload.purpose, jti: payload.jti },
      'consent issued',
    );

    // The token appears here and nowhere else — it is a bearer credential.
    return reply.status(201).send({
      data: {
        consentToken: token,
        jti:          payload.jti,
        expiresAt:    new Date(payload.exp * 1000).toISOString(),
        scope: { agentId: payload.sub, requestorId: payload.aud, purpose: payload.purpose },
        note: 'Single-use. Bound to this agent, this requestor and this purpose.',
      },
    });
  });

  // POST /v1/consent/revoke — withdraw an outstanding authorisation.
  app.post('/v1/consent/revoke', async (req, reply) => {
    const parse = RevokeConsentSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    revokeConsent(parse.data.jti, parse.data.exp);
    req.log.info({ jti: parse.data.jti }, 'consent revoked');
    return reply.send({ data: { jti: parse.data.jti, revoked: true } });
  });

  /**
   * Authorise a lender pull, then record it.
   *
   * Shared by `POST /v1/reports` (the raw credit file) and
   * `POST /v1/lender-reports` (the underwriting packet). The two are different
   * products over the same data, and the rule that must never differ between
   * them is this one: nothing is released without verified consent, and every
   * release that succeeds is recorded as a hard inquiry against the agent.
   * Duplicating that logic per route is how one of them eventually stops
   * checking.
   *
   * Consent is verified *before* the inquiry is recorded — a refused pull must
   * leave no trace on the file, because a recorded hard inquiry is itself a
   * small penalty to the score. The same rule now extends to billing: consent
   * is checked *without being consumed* (`consume: false`) so that a pull
   * refused for insufficient balance does not burn the agent's one-time
   * authorisation — the requestor can top up and retry with the same
   * still-valid token. It is only spent, via `consumeConsent`, once the charge
   * has actually cleared.
   */
  type PullDenial = { ok: false; status: number; body: Record<string, unknown> };
  type PullGrant  = { ok: true; profile: AgentCreditProfile };

  const authoriseAndRecordPull = (input: {
    agentId: string;
    requestorId: string;
    requestorName: string;
    purpose: ConsentPurpose;
    consentToken: string;
    log: { warn: (obj: object, msg: string) => void };
  }): PullDenial | PullGrant => {
    const { agentId, requestorId, requestorName, purpose, consentToken } = input;

    const profile = getProfile(agentId);
    if (!profile) {
      return { ok: false, status: 404, body: { error: 'NotFound', message: `Agent ${agentId} not found` } };
    }
    if (profile.frozenAt) {
      // Deliberately an error rather than a "declined" report: a frozen profile
      // is under a sanctions or legal hold, and the correct response is to
      // release nothing about it, not to release an assessment of it.
      return {
        ok: false,
        status: 403,
        body: { error: 'Frozen', message: 'Agent credit profile is frozen due to sanctions or legal hold' },
      };
    }

    // The consent token is the evidence that this agent authorised this lender
    // to make this kind of pull. It was previously accepted as any non-empty
    // string and stored verbatim, so `"x"` released a full credit file.
    const consent = verifyConsent({ token: consentToken, agentId, requestorId, purpose, consume: false });
    if (!consent.valid) {
      input.log.warn(
        { agentId, requestorId, purpose, reason: consent.reason },
        'credit report refused — consent did not verify',
      );
      return {
        ok: false,
        status: 403,
        body: { error: 'ConsentInvalid', reason: consent.reason, message: consent.detail },
      };
    }

    // Charged before the inquiry is recorded, for the same reason consent is
    // checked first: a declined charge must leave no trace on the file.
    const charge = chargeInquiryFee(requestorId, `inquiry_fee:${agentId}:${purpose}`);
    if (!charge.ok) {
      input.log.warn(
        {
          agentId, requestorId, purpose,
          balanceUsd: centsToUsd(charge.balanceUsdCents),
          requiredUsd: centsToUsd(charge.requiredUsdCents),
        },
        'credit report refused — insufficient prepaid balance',
      );
      return {
        ok: false,
        status: 402,
        body: {
          error:       'PaymentRequired',
          message:     `Insufficient prepaid balance: $${centsToUsd(charge.balanceUsdCents)} available, ` +
                       `$${centsToUsd(charge.requiredUsdCents)} required per pull.`,
          balanceUsd:  centsToUsd(charge.balanceUsdCents),
          requiredUsd: centsToUsd(charge.requiredUsdCents),
          topUpHint:   'POST /v1/billing/:requestorId/topup to fund this account via x402 USDC, ' +
                       'or contact the bureau operator for a manual credit.',
        },
      };
    }

    // The charge cleared — now, and only now, spend the single-use token.
    consumeConsent(consent.payload!.jti, consent.payload!.exp);

    profile.hardInquiries.push({
      id:            randomUUID(),
      requestorId,
      requestorName,
      purpose,
      timestamp:     new Date().toISOString(),
      // The jti, not the token itself. The token is a bearer credential; the
      // jti is the durable, non-replayable reference that ties this inquiry to
      // the authorisation that permitted it.
      consentToken:  consent.payload!.jti,
      billingTransactionId: charge.transaction.id,
    });

    // Recompute score after inquiry (may slightly reduce it)
    const { score, factors } = computeScore(profile);
    profile.currentScore  = score;
    profile.tier          = scoreTier(score);
    profile.scoreFactors  = factors;
    profile.lastUpdatedAt = new Date().toISOString();
    setProfile(profile);

    return { ok: true, profile };
  };

  app.post('/v1/reports', async (req, reply) => {
    const parse = PullReportSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const { agentId, requestorId, requestorName, purpose, consentToken, zkProofMode } = parse.data;

    // `requestorId` is now a billing identity, not just a label — it is who
    // gets charged. Without this check any pull_scores-scoped caller could
    // name an arbitrary requestorId and debit a stranger's prepaid balance for
    // its own pulls.
    const requestorDenied = contributorAccessError(req.auth, requestorId);
    if (requestorDenied) return reply.status(403).send(requestorDenied);

    const pull = authoriseAndRecordPull({ agentId, requestorId, requestorName, purpose, consentToken, log: req.log });
    if (!pull.ok) return reply.status(pull.status).send(pull.body);
    const { profile } = pull;
    const score = profile.currentScore;

    const now    = new Date();
    const expiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    const report: CreditReport = {
      reportId:    randomUUID(),
      agentId,
      requestorId,
      generatedAt: now.toISOString(),
      expiresAt:   expiry.toISOString(),
      profile,
      summary: {
        score,
        tier:               profile.tier,
        recommendation:     scoreRecommendation(score),
        maxRecommendedLimit: maxRecommendedLimit(score),
        riskGrade:          score >= 800 ? 'A' : score >= 670 ? 'B' : score >= 580 ? 'C' : score >= 500 ? 'D' : 'F',
        creditGrade:        creditGrade(score),
        inquiryFeeUsd:      INQUIRY_FEE_USD,
      },
      zkProofMode,
    };

    if (zkProofMode) {
      report.zkProofs = [
        { circuit: 'score_above',              params: { threshold: 700 }, ...generateZKProof(profile, 'score_above', { threshold: 700 }), generatedAt: now.toISOString() },
        { circuit: 'no_default_last_n_months', params: { months: 12 },    ...generateZKProof(profile, 'no_default_last_n_months', { months: 12 }), generatedAt: now.toISOString() },
        { circuit: 'utilization_below',        params: { threshold: 0.8 },...generateZKProof(profile, 'utilization_below', { threshold: 0.8 }), generatedAt: now.toISOString() },
      ];
      // In ZK mode, redact raw history for privacy
      report.profile = { ...profile, creditHistory: [], hardInquiries: [], delinquencies: [] };
    }

    setReport(report);
    return reply.status(201).send({ data: report });
  });

  // GET /v1/reports/:reportId
  app.get<{ Params: { reportId: string } }>('/v1/reports/:reportId', async (req, reply) => {
    const report = getReport(req.params.reportId);
    if (!report) return reply.status(404).send({ error: 'NotFound', message: 'Report not found or expired' });
    if (new Date(report.expiresAt) < new Date()) {
      return reply.status(410).send({ error: 'Gone', message: 'Report has expired (90 days)' });
    }
    return reply.send({ data: report });
  });

  // POST /v1/reports/:reportId/zk — generate ZK proofs
  app.post<{ Params: { reportId: string } }>('/v1/reports/:reportId/zk', async (req, reply) => {
    const report = getReport(req.params.reportId);
    if (!report) return reply.status(404).send({ error: 'NotFound', message: 'Report not found' });

    const parse = ZKProofRequestSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const profile = getProfile(report.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: 'Agent profile not found' });

    const { circuit, params } = parse.data;
    const proof = generateZKProof(profile, circuit, params);

    return reply.send({
      data: {
        ...proof,
        circuit,
        params,
        generatedAt: new Date().toISOString(),
        agentId:     report.agentId,
        reportId:    report.reportId,
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Lender reports — the underwriting packet, readable by humans and agents
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Which representation the caller wants.
   *
   * `Accept: text/markdown` is the correct HTTP mechanism, but `?format=`
   * is honoured too — a loan officer pasting a URL into a browser cannot set
   * headers, and browsers send `Accept: text/html,...` which would otherwise
   * silently win. An explicit query parameter always beats the header.
   */
  const wantsMarkdown = (req: { headers: Record<string, unknown>; query: unknown }): boolean => {
    const format = (req.query as { format?: string } | undefined)?.format;
    if (format) return format === 'markdown' || format === 'md' || format === 'text';
    const accept = req.headers['accept'];
    return typeof accept === 'string' && accept.includes('text/markdown');
  };

  /** Contributor display names, so the report attributes furnishers by name. */
  const furnisherNames = (): Map<string, string> =>
    new Map(Array.from(contributors.values()).map(c => [c.id, c.name]));

  /**
   * GET /v1/lender-reports/schema — the machine-readable vocabulary.
   *
   * Registered before the `:reportId` route for readability; Fastify's router
   * prefers static segments over parametric ones regardless of order.
   *
   * This is what makes the report genuinely consumable by an autonomous
   * underwriter rather than merely being JSON: an agent can resolve any reason
   * code it encounters — including codes introduced after that agent was
   * written — instead of carrying a hardcoded copy that silently goes stale.
   */
  app.get('/v1/lender-reports/schema', async (_req, reply) => {
    return reply.send({
      data: {
        schemaVersion: LENDER_REPORT_SCHEMA_VERSION,
        scoreScale: { min: 0, max: 1000 },
        outcomes: {
          approve:                 'Lend on the requested terms.',
          approve_with_conditions: 'Lend subject to the conditions listed on the report.',
          manual_review:           'Do not decide automatically — route to a human underwriter.',
          decline:                 'Do not lend.',
        },
        confidence: {
          high:     'Thick file, corroborated by more than one furnisher.',
          moderate: 'Usable but limited — thin file, single furnisher, or stale records.',
          low:      'Too little data to rely on; the outcome will be manual_review or decline.',
        },
        sufficiencyLevels: {
          thick_file:   'Twelve or more records over six or more months.',
          thin_file:    'On file, but below the thick-file threshold.',
          insufficient: 'Under three records — cannot support an automated approval.',
        },
        activityTrends: {
          increasing:        'Last 90 days materially busier than the 90 before.',
          stable:            'Comparable activity across both 90-day halves.',
          decreasing:        'Last 90 days materially quieter than the 90 before.',
          dormant:           'No activity for over 180 days.',
          insufficient_data: 'Fewer than three events in the last 180 days — no trend claimed.',
        },
        reasonCodes: REASON_CODE_CATALOG,
        notes: {
          adverseAction:
            'Only codes with adverseAction=true may be cited in a decline notice. ' +
            'Compliance and data-sufficiency codes are excluded by design: an incomplete ' +
            'sanctions screen is a data-quality problem, not a lawful reason to decline a borrower.',
          narrative:
            'Every sentence under `narrative` is generated from the structured fields in the ' +
            'same report, so the human and machine views cannot disagree. Request ' +
            '`Accept: text/markdown` (or `?format=markdown`) on any report route for the human rendering.',
        },
      },
    });
  });

  /**
   * POST /v1/lender-reports — issue an underwriting packet.
   *
   * Consent-gated and records a hard inquiry, exactly as `POST /v1/reports`
   * does, via the shared `authoriseAndRecordPull`.
   */
  app.post('/v1/lender-reports', async (req, reply) => {
    const parse = LenderReportSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const { agentId, requestorId, requestorName, purpose, consentToken } = parse.data;

    // Same billing-identity check as POST /v1/reports — see the comment there.
    const requestorDenied = contributorAccessError(req.auth, requestorId);
    if (requestorDenied) return reply.status(403).send(requestorDenied);

    const pull = authoriseAndRecordPull({ agentId, requestorId, requestorName, purpose, consentToken, log: req.log });
    if (!pull.ok) return reply.status(pull.status).send(pull.body);

    // Screened at report time rather than read from the profile: a lender is
    // entitled to a compliance check as of this pull, not as of whenever the
    // agent last happened to be screened. Fails closed — an unreachable
    // screening service produces a decline, never a silent pass.
    const sanctions = await sanctionsScreen(pull.profile);

    const report = buildLenderReport({
      reportId:      randomUUID(),
      profile:       pull.profile,
      requestorId,
      requestorName,
      purpose:       purpose as LenderReportPurpose,
      sanctions,
      furnisherNames: furnisherNames(),
      inquiryRecorded: true,
    });

    setLenderReport(report);

    if (wantsMarkdown(req)) {
      return reply.status(201).type('text/markdown; charset=utf-8').send(renderLenderReportMarkdown(report));
    }
    return reply.status(201).send({ data: report });
  });

  /**
   * GET /v1/lender-reports/:reportId — retrieve a previously issued packet.
   *
   * Returns the document as issued, not a fresh assessment. A lender that
   * extended credit on a report must be able to produce that exact report in an
   * audit; re-deriving it would score against a profile that has since moved.
   */
  app.get<{ Params: { reportId: string }; Querystring: { format?: string } }>(
    '/v1/lender-reports/:reportId',
    async (req, reply) => {
      const report = getLenderReport(req.params.reportId);
      if (!report) return reply.status(404).send({ error: 'NotFound', message: 'Lender report not found' });

      // A stale underwriting packet is worse than none — it looks authoritative
      // while describing an agent that has since changed.
      if (new Date(report.expiresAt) < new Date()) {
        return reply.status(410).send({
          error: 'Gone',
          message: `Lender report expired at ${report.expiresAt}. Pull a fresh report.`,
        });
      }

      // A furnisher may retrieve only the reports it requested; admin sees any.
      // Without this, any key with pull_scores could read a competitor's
      // underwriting decisions — the same cross-tenant read closed on the
      // contributor routes.
      const denied = contributorAccessError(req.auth, report.requestorId);
      if (denied) return reply.status(403).send(denied);

      if (wantsMarkdown(req)) {
        return reply.type('text/markdown; charset=utf-8').send(renderLenderReportMarkdown(report));
      }
      return reply.send({ data: report });
    },
  );

  /**
   * GET /v1/lender-reports — a lender's own issued-report history.
   *
   * Scoped to the calling principal for the same reason as the route above;
   * admin may filter by `requestorId`.
   */
  app.get<{ Querystring: { agentId?: string; requestorId?: string; limit?: string } }>(
    '/v1/lender-reports',
    async (req, reply) => {
      const isAdmin = req.auth?.kind === 'admin';
      const requestorId = isAdmin ? req.query.requestorId : req.auth?.principalId;

      // A non-admin key with no resolvable principal must not fall through to
      // an unfiltered list.
      if (!isAdmin && !requestorId) {
        return reply.status(403).send({ error: 'Forbidden', message: 'Cannot resolve the calling principal.' });
      }

      const filter: { agentId?: string; requestorId?: string } = {};
      if (req.query.agentId) filter.agentId = req.query.agentId;
      if (requestorId) filter.requestorId = requestorId;

      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
      const all = listLenderReports(filter);

      // Summaries, not full documents — a history listing that inlined every
      // report would return megabytes and re-disclose whole credit files.
      const data = all.slice(0, limit).map(r => ({
        reportId:    r.reportId,
        agentId:     r.agentId,
        requestorId: r.requestorId,
        purpose:     r.purpose,
        outcome:     r.decision.outcome,
        score:       r.decision.score,
        grade:       r.decision.grade,
        confidence:  r.decision.confidence,
        generatedAt: r.generatedAt,
        expiresAt:   r.expiresAt,
      }));

      return reply.send({ data, total: all.length });
    },
  );

  // ═══════════════════════════════════════════════════════════════════════════
  // Billing — the prepaid ledger that INQUIRY_FEE_USD is actually charged
  // against. See billing.ts for the ledger and x402 top-up logic.
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /v1/billing/:requestorId/account
  app.get<{ Params: { requestorId: string } }>('/v1/billing/:requestorId/account', async (req, reply) => {
    const denied = contributorAccessError(req.auth, req.params.requestorId);
    if (denied) return reply.status(403).send(denied);

    const account = getAccountSummary(req.params.requestorId);
    return reply.send({
      data: {
        requestorId:      account.requestorId,
        balanceUsd:       centsToUsd(account.balanceUsdCents),
        inquiryFeeUsd:    INQUIRY_FEE_USD,
        pullsRemaining:   Math.floor(account.balanceUsdCents / usdToCents(INQUIRY_FEE_USD)),
        createdAt:        account.createdAt,
        updatedAt:        account.updatedAt,
      },
    });
  });

  // GET /v1/billing/:requestorId/transactions — the ledger, most recent first
  app.get<{ Params: { requestorId: string }; Querystring: { limit?: string } }>(
    '/v1/billing/:requestorId/transactions', async (req, reply) => {
      const denied = contributorAccessError(req.auth, req.params.requestorId);
      if (denied) return reply.status(403).send(denied);

      const all   = billingHistory(req.params.requestorId);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit ?? '50', 10) || 50));
      const data  = all.slice(0, limit).map(t => ({
        id:              t.id,
        type:            t.type,
        amountUsd:       centsToUsd(t.amountUsdCents),
        balanceAfterUsd: centsToUsd(t.balanceAfterUsdCents),
        reason:          t.reason,
        createdAt:       t.createdAt,
      }));
      return reply.send({ data, total: all.length });
    },
  );

  // POST /v1/billing/:requestorId/topup — open an x402 USDC top-up
  app.post<{ Params: { requestorId: string } }>('/v1/billing/:requestorId/topup', async (req, reply) => {
    const denied = contributorAccessError(req.auth, req.params.requestorId);
    if (denied) return reply.status(403).send(denied);

    const parse = TopUpSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const outcome = await requestTopUp(req.params.requestorId, parse.data.amountUsd);
    if (!outcome.ok) {
      const status = outcome.reason === 'not_configured' ? 503
        : outcome.reason === 'amount_invalid' ? 400
        : 502;
      return reply.status(status).send({ error: 'TopUpFailed', reason: outcome.reason, message: outcome.message });
    }

    return reply.status(201).send({
      data: {
        receiptId: outcome.receipt.receiptId,
        amountUsd: outcome.receipt.amountUsd,
        status:    outcome.receipt.status,
        gateway:   outcome.gateway,
        note:
          'Send USDC on Base for this amount to the vault address published at ' +
          'GET {STABLECOIN_GATEWAY_URL}/x402/payment-required, then confirm with ' +
          'POST /v1/billing/:requestorId/topup/:receiptId/confirm once the transfer has settled.',
      },
    });
  });

  // POST /v1/billing/:requestorId/topup/:receiptId/confirm
  app.post<{ Params: { requestorId: string; receiptId: string } }>(
    '/v1/billing/:requestorId/topup/:receiptId/confirm', async (req, reply) => {
      const denied = contributorAccessError(req.auth, req.params.requestorId);
      if (denied) return reply.status(403).send(denied);

      const outcome = await confirmTopUp(req.params.receiptId, req.params.requestorId);
      if (!outcome.ok) {
        const status = outcome.reason === 'not_found'          ? 404
          : outcome.reason === 'requestor_mismatch' ? 403
          : outcome.reason === 'not_yet_paid'        ? 409
          : outcome.reason === 'not_configured'      ? 503
          : 502;
        return reply.status(status).send({ error: 'TopUpNotConfirmed', reason: outcome.reason, message: outcome.message });
      }

      return reply.send({
        data: {
          confirmed:        true,
          alreadyConfirmed: outcome.alreadyConfirmed,
          balanceUsd:       centsToUsd(outcome.account.balanceUsdCents),
        },
      });
    },
  );

  // POST /v1/billing/:requestorId/credit — admin-only manual credit, for wire
  // transfers, invoiced customers, and support adjustments outside the x402
  // flow. Deliberately absent from ROUTE_SCOPES: deny-by-default already
  // requires `admin` for anything unlisted.
  app.post<{ Params: { requestorId: string } }>('/v1/billing/:requestorId/credit', async (req, reply) => {
    const parse = AdminCreditSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const { account, transaction } = creditAccount(
      req.params.requestorId, parse.data.amountUsd, `manual:${parse.data.reason}`,
    );
    return reply.status(201).send({
      data: {
        balanceUsd: centsToUsd(account.balanceUsdCents),
        transaction: { ...transaction, amountUsd: centsToUsd(transaction.amountUsdCents) },
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Disputes — FCRA-compliant 30-day resolution
  // ═══════════════════════════════════════════════════════════════════════════

  // A dispute past its 30-day deadline gets escalatedAt stamped on read and
  // persisted, so escalation is a durable fact discovered once rather than
  // recomputed (and silently lost) on every subsequent read.
  const persistEscalationIfDue = (d: Dispute): Dispute => {
    const checked = withEscalationCheck(d);
    if (checked !== d) setDispute(checked);
    return checked;
  };

  // GET /v1/agents/:agentId/disputes
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/disputes', async (req, reply) => {
    const data = listDisputes({ agentId: req.params.agentId }).map(persistEscalationIfDue);
    return reply.send({ data, total: data.length });
  });

  // POST /v1/agents/:agentId/disputes — file a dispute
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/disputes', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: 'Agent not found' });

    const parse = FileDisputeSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const disputedEvent = profile.creditHistory.find(e => e.id === parse.data.eventId);
    if (!disputedEvent) {
      return reply.status(400).send({
        error:   'ValidationError',
        message: `eventId ${parse.data.eventId} is not on agent ${req.params.agentId}'s credit history.`,
      });
    }

    // The furnisher is the event's own provenance, not whatever the filer
    // claims — a dispute has to accurately identify who furnished the data it
    // disputes, both so resolution can notify the right party and so a filer
    // cannot name an arbitrary furnisher. Events written before the 1b
    // furnisher pipeline carry no contributorId, so this can be undefined.
    const derivedFurnisherId = furnisherForEvent(disputedEvent);
    if (parse.data.furnisherId && derivedFurnisherId && parse.data.furnisherId !== derivedFurnisherId) {
      return reply.status(400).send({
        error:   'ValidationError',
        message: `furnisherId "${parse.data.furnisherId}" does not match the furnisher on record for this event ` +
                  `("${derivedFurnisherId}").`,
      });
    }

    const dispute: Dispute = {
      id:          randomUUID(),
      agentId:     req.params.agentId,
      eventId:     parse.data.eventId,
      description: parse.data.description,
      evidence:    parse.data.evidence,
      furnisherId: derivedFurnisherId ?? parse.data.furnisherId,
      status:      'open',
      filedAt:     new Date().toISOString(),
    };

    setDispute(dispute);
    return reply.status(201).send({ data: dispute });
  });

  // PUT /v1/disputes/:disputeId — resolve (or advance) a dispute
  //
  // A resolved_corrected or resolved_deleted outcome previously updated only
  // this record — the disputed event stayed on the agent's creditHistory and
  // the score was never recomputed, so the disputed data survived its own
  // deletion. resolveDispute() (src/disputes.ts) now mutates the record it
  // resolves and re-derives the score through the same single source of truth
  // used everywhere else in the bureau.
  app.put<{ Params: { disputeId: string } }>('/v1/disputes/:disputeId', async (req, reply) => {
    const dispute = getDispute(req.params.disputeId);
    if (!dispute) return reply.status(404).send({ error: 'NotFound', message: 'Dispute not found' });

    const parse = UpdateDisputeSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const profile = getProfile(dispute.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: `Agent ${dispute.agentId} not found` });

    const result = resolveDispute({
      profile,
      dispute,
      status:     parse.data.status,
      resolution: parse.data.resolution,
      correction: parse.data.correction as DisputeCorrection | undefined,
    });

    if (!result.ok) {
      const statusCode = result.error === 'already_resolved' ? 409
                        : result.error === 'event_not_found'  ? 404
                        : 400;
      return reply.status(statusCode).send({ error: 'DisputeResolutionError', reason: result.error, message: result.message });
    }

    setDispute(result.dispute);
    if (result.historyChanged) {
      setProfile(result.profile);

      // The information a furnisher notification needs — no delivery
      // transport exists yet, so this is the audit trail for when one does.
      if (dispute.furnisherId) {
        req.log.info(
          { disputeId: dispute.id, agentId: dispute.agentId, furnisherId: dispute.furnisherId,
            eventId: dispute.eventId, outcome: result.dispute.status },
          'furnisher data corrected by dispute resolution — notification pending (no delivery transport wired)',
        );
      }
    }

    return reply.send({ data: result.dispute });
  });

  // GET /v1/disputes — list all disputes (for compliance officers)
  app.get<{ Querystring: { status?: string; limit?: string } }>('/v1/disputes', async (req, reply) => {
    const q = req.query as { status?: string; limit?: string };
    const limit  = Math.min(parseInt(q.limit ?? '50', 10), 500);
    const data   = listDisputes(q.status ? { status: q.status } : undefined).slice(0, limit).map(persistEscalationIfDue);
    return reply.send({ data, total: data.length });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Data Contributors
  // ═══════════════════════════════════════════════════════════════════════════

  // POST /v1/contributors — register
  app.post('/v1/contributors', async (req, reply) => {
    const parse = RegisterContributorSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const id: string = randomUUID();

    // Issued once, here, and never stored. Only the digest is persisted, so a
    // dump of the store or the database yields no usable credential.
    const rawApiKey = `ck_${randomBytes(24).toString('base64url')}`;

    const contributor = {
      id,
      name:                    parse.data.name,
      type:                    parse.data.type,
      apiKeyHash:              hashApiKey(rawApiKey),
      permissions:             parse.data.permissions,
      queriesUsed:             0,
      queriesAllowed:          5000, // default; grows as they contribute data
      dataRecordsContributed:  0,
      createdAt:               new Date().toISOString(),
      status:                  'pending' as const,
    };

    setContributor(contributor);

    // `apiKey` appears in this response and nowhere else, ever.
    return reply.status(201).send({
      data: {
        ...redactContributor(contributor),
        apiKey: rawApiKey,
        note: 'Store this key now — it cannot be retrieved again. The contributor is `pending` until an operator activates it.',
      },
    });
  });

  // PUT /v1/contributors/:id/status — activate, suspend or re-hold a furnisher
  //
  // The missing half of the lifecycle. Registration created every contributor
  // as `pending`, and both the auth layer and the ingest route reject anything
  // not `active` — but nothing anywhere could set that, so a real furnisher
  // registered, received a key and was permanently locked out. Only the three
  // seeded demo contributors could ever ingest.
  //
  // Admin-only. Deliberately absent from ROUTE_SCOPES: auth.ts is
  // deny-by-default, so an unlisted route already requires `admin`.
  app.put<{ Params: { id: string } }>('/v1/contributors/:id/status', async (req, reply) => {
    const parse = ContributorStatusSchema.safeParse(req.body);
    if (!parse.success) {
      return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    }

    const contributor = getContributor(req.params.id);
    if (!contributor) {
      return reply.status(404).send({ error: 'NotFound', message: 'Contributor not found' });
    }

    const previous = contributor.status;
    contributor.status          = parse.data.status;
    contributor.statusReason    = parse.data.reason;
    contributor.statusChangedAt = new Date().toISOString();
    setContributor(contributor);

    // A suspension takes effect on the next request: resolvePrincipal in
    // auth.ts resolves a non-active contributor's key to no principal at all.
    req.log.info(
      { contributorId: contributor.id, from: previous, to: contributor.status, reason: parse.data.reason },
      'contributor status changed',
    );

    return reply.send({
      data: { ...redactContributor(contributor), previousStatus: previous },
    });
  });

  // POST /v1/contributors/:id/ingest — bulk event ingestion
  app.post<{ Params: { id: string } }>('/v1/contributors/:id/ingest', async (req, reply) => {
    // A furnisher may only ingest as itself. The scope table proves the caller
    // may ingest at all; it cannot prove it may ingest *as this contributor*.
    const denied = contributorAccessError(req.auth, req.params.id);
    if (denied) return reply.status(403).send(denied);

    const contributor = getContributor(req.params.id);
    if (!contributor) return reply.status(404).send({ error: 'NotFound', message: 'Contributor not found' });
    if (contributor.status !== 'active') return reply.status(403).send({ error: 'Forbidden', message: 'Contributor not yet active' });

    const parse = IngestEventsSchema.safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });

    const { agentId, events } = parse.data;
    const profile = getProfile(agentId);
    if (!profile) {
      return reply.status(404).send({ error: 'NotFound', message: `Agent ${agentId} not registered — register the agent first` });
    }

    // A furnisher may only report credit it extended itself. `creditorId` used
    // to be trusted straight from the payload, so any furnisher could attribute
    // lending to anyone. Events with no creditor concept (identity_verified,
    // sanctions_hit) are still attributed via contributorId below.
    const impostor = events.find(
      e => e.creditorId !== undefined && e.creditorId !== contributor.id,
    );
    if (impostor) {
      return reply.status(400).send({
        error: 'ValidationError',
        message:
          `creditorId "${impostor.creditorId}" does not match the authenticated contributor ` +
          `"${contributor.id}". A furnisher may only report credit it extended itself; ` +
          `omit creditorId and it will be set for you.`,
      });
    }

    // Quota. queriesUsed and queriesAllowed both existed but were never once
    // compared, so the limit was decorative.
    if (contributor.queriesUsed >= contributor.queriesAllowed) {
      return reply.status(429).send({
        error:   'Too Many Requests',
        message: `Ingest quota exhausted (${contributor.queriesUsed}/${contributor.queriesAllowed}). ` +
                 `Quota grows as you contribute data, up to the per-window cap.`,
      });
    }

    // Rolling window for the growth cap and for anomaly visibility.
    const nowMs = Date.now();
    const windowStart = contributor.windowStartedAt ? Date.parse(contributor.windowStartedAt) : 0;
    if (!contributor.windowStartedAt || nowMs - windowStart > INGEST_WINDOW_MS) {
      contributor.windowStartedAt   = new Date(nowMs).toISOString();
      contributor.recordsThisWindow = 0;
    }

    // Idempotency: (contributorId, externalId) identifies an event uniquely, so
    // a retried batch is recognised rather than written twice — which would
    // otherwise double-count the furnisher's contribution and, per the
    // published revenue share, its payout.
    const seen = new Set(
      profile.creditHistory
        .filter(e => e.contributorId === contributor.id && e.externalId)
        .map(e => e.externalId as string),
    );

    const ingested: CreditEvent[] = [];
    const duplicates: string[] = [];

    for (const e of events) {
      if (seen.has(e.externalId)) {
        duplicates.push(e.externalId);
        continue;
      }
      seen.add(e.externalId);
      ingested.push({
        ...e,
        id:            randomUUID(),
        agentId,
        timestamp:     new Date().toISOString(),
        // Provenance is server-set — a furnisher cannot attribute a record to
        // anyone else, by construction.
        contributorId: contributor.id,
        creditorId:    e.creditorId ?? contributor.id,
      });
    }

    profile.creditHistory.push(...ingested);

    // Contribution counters. The window cap stops a furnisher minting unlimited
    // quota (and revenue share) by ingesting junk — the "captured furnisher"
    // case. Duplicates are excluded: a retry must not inflate anything.
    const creditable = Math.min(
      ingested.length,
      Math.max(0, INGEST_WINDOW_CAP - (contributor.recordsThisWindow ?? 0)),
    );
    contributor.recordsThisWindow      = (contributor.recordsThisWindow ?? 0) + ingested.length;
    contributor.dataRecordsContributed += creditable;
    contributor.queriesAllowed = Math.min(1_000_000, 5000 + contributor.dataRecordsContributed * 0.5);
    contributor.queriesUsed   += 1;
    setContributor(contributor);

    // paymentHistoryRate does not move on its own — it must be recomputed
    // whenever creditHistory changes, exactly like score/tier/factors below.
    // Without this, ingesting a batch of defaults through the real furnisher
    // pipeline left the rate (and 35% of the score) untouched entirely.
    profile.paymentHistoryRate = computePaymentHistoryRate(profile.creditHistory);

    // Re-derive through the single source of truth rather than recomputing
    // inline, so score, tier and factors cannot drift apart here.
    profile.lastUpdatedAt = new Date().toISOString();
    const updated = deriveScoreFields(profile);
    setProfile(updated);

    return reply.status(201).send({
      data: {
        ingestedCount:     ingested.length,
        duplicatesIgnored: duplicates.length,
        creditedToQuota:   creditable,
        windowCapped:      creditable < ingested.length,
        newScore:          updated.currentScore,
        events:            ingested,
      },
    });
  });

  // GET /v1/contributors/:id/stats
  app.get<{ Params: { id: string } }>('/v1/contributors/:id/stats', async (req, reply) => {
    // Volume and quota are commercially sensitive; a furnisher reads only its own.
    const denied = contributorAccessError(req.auth, req.params.id);
    if (denied) return reply.status(403).send(denied);

    const contributor = getContributor(req.params.id);
    if (!contributor) return reply.status(404).send({ error: 'NotFound', message: 'Contributor not found' });
    contributor.queriesUsed += 1; // count this query
    setContributor(contributor);
    return reply.send({ data: redactContributor(contributor) });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bureau Analytics
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /v1/bureau/stats
  app.get('/v1/bureau/stats', async (_req, reply) => {
    return reply.send({ data: bureauStats() });
  });

  // GET /v1/agents — list all profiles
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/v1/agents', async (req, reply) => {
    const q      = req.query as { limit?: string; offset?: string };
    const limit  = Math.min(parseInt(q.limit ?? '50', 10), 200);
    const offset = parseInt(q.offset ?? '0', 10);
    const data   = listProfiles(limit, offset);
    return reply.send({ data, total: profiles.size });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Dual-Mode Score — Mode 1 (FICO) + Mode 2 (On-chain operational)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /v1/agents/:agentId/dual-score
  // Returns both scoring lenses + consensus analysis.
  // Mode 1 is always live (<15ms). Mode 2 is from last settlement + on-chain stats.
  // Response shape: DualModeScore (see types.ts)
  app.get<{ Params: { agentId: string } }>('/v1/agents/:agentId/dual-score', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: `Agent ${req.params.agentId} not registered` });

    const chain   = getChainClient();
    const receipt = getSettlementReceipt(req.params.agentId);

    // Explicit address first, self-certifying DID as fallback.
    const eligibility  = settlementEligibility(profile);
    const agentAddress = eligibility.address as `0x${string}` | undefined;

    // Why Mode 2 may be absent. Previously the response carried a bare
    // `mode2: null` with no way for a caller to tell an unconfigured chain from
    // an agent that can never settle.
    const mode2Unavailable =
      chain === null          ? { reason: 'chain_unconfigured', detail: 'The bureau has no on-chain client configured; Mode 1 is authoritative.' }
      : !agentAddress         ? { reason: eligibility.reason, detail: eligibility.detail }
      : receipt === undefined ? { reason: 'not_yet_settled', detail: 'This agent has no settlement receipt yet; the next settlement run will publish one.' }
      : null;

    // Compute account age in months from profile.createdAt
    const ageMonths = Math.max(0,
      (Date.now() - new Date(profile.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 30.44),
    );

    // Fetch Mode 2 inputs from on-chain (null if chain unconfigured or agent has no on-chain data)
    const mode2Inputs = (chain && agentAddress)
      ? await chain.getMode2Inputs(agentAddress, ageMonths).catch(() => null)
      : null;

    const dualScore = computeDualModeScore(
      profile.agentId,
      profile,
      mode2Inputs,
      receipt ? {
        txHash:      receipt.txHash,
        blockNumber: receipt.blockNumber,
        chainId:     receipt.chainId,
        settledAt:   receipt.settledAt,
      } : undefined,
    );

    return reply.send({
      data: {
        ...dualScore,
        grade: creditGrade(dualScore.mode1.score),
        settlement: {
          eligible: eligibility.eligible,
          address:  eligibility.address ?? null,
          ...(eligibility.reason ? { reason: eligibility.reason, detail: eligibility.detail } : {}),
        },
        ...(mode2Unavailable ? { mode2Unavailable } : {}),
      },
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Verification — 8-check agent verify + sanctions screen (Qova-derived)
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /v1/grade-scale — the published AAA–D rating scale
  app.get('/v1/grade-scale', async (_req, reply) => {
    return reply.send({ data: { scale: GRADE_SCALE, inquiryFeeUsd: INQUIRY_FEE_USD } });
  });

  // POST /v1/agents/:agentId/verify — run all 8 checks
  app.post<{ Params: { agentId: string } }>('/v1/agents/:agentId/verify', async (req, reply) => {
    const profile = getProfile(req.params.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: `Agent ${req.params.agentId} not registered` });
    return reply.send({ data: await verifyAgent(profile) });
  });

  // POST /v1/verify/sanctions — sanctions screen only
  app.post('/v1/verify/sanctions', async (req, reply) => {
    const parse = z.object({ agentId: z.string().min(1) }).safeParse(req.body);
    if (!parse.success) return reply.status(400).send({ error: 'ValidationError', details: parse.error.flatten() });
    const profile = getProfile(parse.data.agentId);
    if (!profile) return reply.status(404).send({ error: 'NotFound', message: `Agent ${parse.data.agentId} not registered` });
    return reply.send({ data: await sanctionsScreen(profile) });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Settlement — admin endpoints for Mode 2 on-chain settlement
  // ═══════════════════════════════════════════════════════════════════════════

  // GET /v1/settlement/status
  app.get('/v1/settlement/status', async (_req, reply) => {
    const chain   = getChainClient();
    const lastRun = getLastSettlementRun();
    return reply.send({
      data: {
        chainConfigured:   chain !== null,
        chainId:           chain?.chainId ?? null,
        settlementAddress: chain?.address ?? null,
        runCount:          getSettlementRunCount(),
        lastRun,
        settledAgents:     profiles.size > 0
          ? Array.from(profiles.keys()).filter(id => getSettlementReceipt(id) !== undefined).length
          : 0,
        pendingAgents: profiles.size > 0
          ? Array.from(profiles.keys()).filter(id => getSettlementReceipt(id) === undefined).length
          : 0,

        // Agents that can never settle as configured. Previously invisible: an
        // unresolvable DID was skipped on every run with the only trace a
        // string in the run's error array, so an operator had no way to ask
        // "who is stuck, and why".
        ineligibleAgents: Array.from(profiles.values())
          .map(p => ({ agentId: p.agentId, ...settlementEligibility(p) }))
          .filter(e => !e.eligible)
          .map(e => ({ agentId: e.agentId, reason: e.reason, detail: e.detail })),
      },
    });
  });

  // POST /v1/settlement/run — manual trigger (admin only in production, open for staging)
  app.post('/v1/settlement/run', async (_req, reply) => {
    const result = await runSettlement('manual');
    return reply.send({
      data: result,
      message: result.agentsFailed > 0
        ? `Partial settlement: ${result.agentsSettled} settled, ${result.agentsFailed} failed`
        : `Settlement complete: ${result.agentsSettled} agents settled in ${result.txHashes.length} tx(s)`,
    });
  });

  // ── Error handlers ─────────────────────────────────────────────────────────
  app.setErrorHandler<FastifyError>((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'Unhandled error');
    reply.status(err.statusCode ?? 500).send({
      error:   err.name ?? 'InternalServerError',
      message: err.message,
    });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send({ error: 'NotFound', path: req.url });
  });

  return app;
}

// ── Startup ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = await buildApp();

  // Bring the store online against Postgres when configured (migrate + hydrate,
  // or seed-if-empty). No-op when no database is configured — the in-memory
  // demo seed already loaded at module import.
  await initPersistence();
  await hydrateSettlements();

  const shutdown = async () => {
    app.log.info('[credit-bureau] Shutting down...');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT',  shutdown);

  await app.listen({ port: PORT, host: '0.0.0.0' });

  // Start Mode 2 settlement scheduler (runs even if chain is unconfigured — no-ops gracefully)
  startSettlementScheduler();

  const chainClient = getChainClient();
  console.log(`
╔══════════════════════════════════════════════════════════════════╗
║      ForgePay Agent Credit Bureau v0.1.0                         ║
║      Listening on port ${PORT}                                      ║
║                                                                  ║
║  Score        →  GET  /v1/agents/:id/score        [Mode 1 FICO]  ║
║  Dual Score   →  GET  /v1/agents/:id/dual-score   [Mode 1+2]     ║
║  Verify       →  POST /v1/agents/:id/verify       [8 checks]     ║
║  Grade Scale  →  GET  /v1/grade-scale             [AAA–D]        ║
║  Profile      →  GET  /v1/agents/:id/profile                     ║
║  Report       →  POST /v1/reports                                ║
║  Billing      →  GET  /v1/billing/:id/account     [$2.80/pull]   ║
║  Disputes     →  GET  /v1/disputes                               ║
║  Bureau Stats →  GET  /v1/bureau/stats                           ║
║  Settlement   →  GET  /v1/settlement/status                      ║
║                                                                  ║
║  On-chain: ${chainClient ? `Base chainId=${chainClient.chainId} ✓` : 'unconfigured — Mode 1 only '}        ║
╚══════════════════════════════════════════════════════════════════╝
`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[credit-bureau] Fatal startup error:', err);
    process.exit(1);
  });
}

export { buildApp };
