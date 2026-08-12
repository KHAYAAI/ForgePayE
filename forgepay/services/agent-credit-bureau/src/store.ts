/**
 * ForgePay Agent Credit Bureau — In-Memory Store
 * ────────────────────────────────────────────────
 * Map-based store seeded with realistic demo agents.
 * Production: swap for PostgreSQL + TimescaleDB.
 */

import type {
  AgentCreditProfile,
  CreditEvent,
  Dispute,
  CreditReport,
  DataContributor,
  BillingAccount,
  BillingTransaction,
  TopUpReceipt,
} from './types';
import { computeScore } from './scorer';
import { hashApiKey } from './hash';
import { gradeDistribution, INQUIRY_FEE_USD } from './grade';
import type { LenderReport } from './lender-report';
import {
  isDbEnabled, runMigrations,
  upsertProfile, upsertDispute, upsertReport, upsertContributor, upsertLenderReport,
  loadAllProfiles, loadAllDisputes, loadAllReports, loadAllContributors, loadAllLenderReports,
  upsertBillingAccount, upsertBillingTransaction, upsertTopUpReceipt,
  loadAllBillingAccounts, loadAllBillingTransactions, loadAllTopUpReceipts,
} from './db';

/** Fire-and-forget persistence error logger — keeps mutators synchronous. */
const persistErr = (what: string) => (e: unknown) =>
  console.error(`[credit-bureau] failed to persist ${what}:`, e);

// ── Stores ────────────────────────────────────────────────────────────────────

export const profiles  = new Map<string, AgentCreditProfile>();
export const disputes  = new Map<string, Dispute>();
export const reports   = new Map<string, CreditReport>();
export const contributors = new Map<string, DataContributor>();

/**
 * Underwriting packets issued to third-party lenders. Kept apart from
 * `reports` (the raw credit file) because a lender must be able to retrieve the
 * exact document it made a credit decision on — the profile it scored against
 * will have moved by the time anyone asks.
 */
export const lenderReports = new Map<string, LenderReport>();

/** Prepaid billing ledger — see billing.ts for the credit/debit logic over these. */
export const billingAccounts = new Map<string, BillingAccount>();
export const billingTransactions = new Map<string, BillingTransaction>();
export const topUpReceipts = new Map<string, TopUpReceipt>();

// ── Helpers ───────────────────────────────────────────────────────────────────

export const getProfile  = (id: string) => profiles.get(id);
export const setProfile  = (p: AgentCreditProfile) => { profiles.set(p.agentId, p); if (isDbEnabled()) upsertProfile(p).catch(persistErr('profile')); return p; };
export const getDispute  = (id: string) => disputes.get(id);
export const setDispute  = (d: Dispute) => { disputes.set(d.id, d); if (isDbEnabled()) upsertDispute(d).catch(persistErr('dispute')); return d; };
export const getReport   = (id: string) => reports.get(id);
export const setReport   = (r: CreditReport) => { reports.set(r.reportId, r); if (isDbEnabled()) upsertReport(r).catch(persistErr('report')); return r; };
export const getLenderReport = (id: string) => lenderReports.get(id);
export const setLenderReport = (r: LenderReport) => { lenderReports.set(r.reportId, r); if (isDbEnabled()) upsertLenderReport(r).catch(persistErr('lender report')); return r; };
export const listLenderReports = (filter?: { agentId?: string; requestorId?: string }) => {
  let all = Array.from(lenderReports.values());
  if (filter?.agentId)     all = all.filter(r => r.agentId === filter.agentId);
  if (filter?.requestorId) all = all.filter(r => r.requestorId === filter.requestorId);
  return all.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
};
export const getContributor = (id: string) => contributors.get(id);
export const setContributor = (c: DataContributor) => { contributors.set(c.id, c); if (isDbEnabled()) upsertContributor(c).catch(persistErr('contributor')); return c; };

export const getBillingAccount = (requestorId: string) => billingAccounts.get(requestorId);
export const setBillingAccount = (a: BillingAccount) => { billingAccounts.set(a.requestorId, a); if (isDbEnabled()) upsertBillingAccount(a).catch(persistErr('billing account')); return a; };
export const recordBillingTransaction = (t: BillingTransaction) => { billingTransactions.set(t.id, t); if (isDbEnabled()) upsertBillingTransaction(t).catch(persistErr('billing transaction')); return t; };
export const listBillingTransactions = (requestorId: string) =>
  Array.from(billingTransactions.values())
    .filter(t => t.requestorId === requestorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
export const getTopUpReceipt = (receiptId: string) => topUpReceipts.get(receiptId);
export const setTopUpReceipt = (r: TopUpReceipt) => { topUpReceipts.set(r.receiptId, r); if (isDbEnabled()) upsertTopUpReceipt(r).catch(persistErr('topup receipt')); return r; };

export function listDisputes(filter?: { status?: string; agentId?: string }) {
  let all = Array.from(disputes.values());
  if (filter?.status)  all = all.filter(d => d.status === filter.status);
  if (filter?.agentId) all = all.filter(d => d.agentId === filter.agentId);
  return all.sort((a, b) => b.filedAt.localeCompare(a.filedAt));
}

export function listProfiles(limit = 50, offset = 0) {
  return Array.from(profiles.values()).slice(offset, offset + limit);
}

export function bureauStats() {
  const all = Array.from(profiles.values());
  const avgScore = all.length
    ? Math.round(all.reduce((s, p) => s + p.currentScore, 0) / all.length)
    : 0;
  const totalDebt = all.reduce((s, p) => s + p.totalDebt, 0);
  const totalLimit = all.reduce((s, p) => s + p.totalCreditLimit, 0);
  const delinquent = all.filter(p => p.delinquencies.some(d => d.status === 'open')).length;
  const distribution = {
    SUPER_PRIME:  all.filter(p => p.currentScore >= 800).length,
    PRIME:        all.filter(p => p.currentScore >= 670 && p.currentScore < 800).length,
    NEAR_PRIME:   all.filter(p => p.currentScore >= 580 && p.currentScore < 670).length,
    SUBPRIME:     all.filter(p => p.currentScore >= 500 && p.currentScore < 580).length,
    DEEP_SUBPRIME:all.filter(p => p.currentScore < 500).length,
  };
  const allInquiries = all.flatMap(p => p.hardInquiries);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const inquiries24h = allInquiries.filter(i => new Date(i.timestamp).getTime() > dayAgo).length;

  // Real revenue, summed from the billing ledger rather than derived as
  // `inquiries × fee`. The two used to be interchangeable because nothing
  // charged anything; now a pull only ever reaches `authoriseAndRecordPull`'s
  // inquiry-recording step after its billing charge has already succeeded, so
  // this sum is exact — and, unlike the derived figure, it stays correct if
  // INQUIRY_FEE_USD ever changes, since each transaction records the fee that
  // actually applied at the time it was charged. Demo/seed inquiries predate
  // billing and were never charged, so they no longer inflate this number.
  const inquiryRevenueUsdCents = Array.from(billingTransactions.values())
    .filter(t => t.type === 'debit' && t.reason.startsWith('inquiry_fee:'))
    .reduce((s, t) => s + t.amountUsdCents, 0);
  const totalPrepaidBalanceUsdCents = Array.from(billingAccounts.values())
    .reduce((s, a) => s + a.balanceUsdCents, 0);

  return {
    totalAgents: all.length,
    avgScore,
    totalDebt,
    totalCreditLimit: totalLimit,
    utilizationRate: totalLimit ? +(totalDebt / totalLimit).toFixed(4) : 0,
    delinquentAgents: delinquent,
    distribution,
    gradeDistribution: gradeDistribution(all.map(p => p.currentScore)),
    inquiries24h,
    inquiriesTotal: allInquiries.length,
    inquiryFeeUsd: INQUIRY_FEE_USD,
    inquiryRevenueUsd: +(inquiryRevenueUsdCents / 100).toFixed(2),
    billingAccounts: billingAccounts.size,
    totalPrepaidBalanceUsd: +(totalPrepaidBalanceUsdCents / 100).toFixed(2),
    openDisputes: Array.from(disputes.values()).filter(d => d.status === 'open' || d.status === 'investigating').length,
    contributors: contributors.size,
  };
}

// ── Seed data ─────────────────────────────────────────────────────────────────

/**
 * Derive the score-bearing fields of a profile from its underlying credit data.
 *
 * `computeScore` is the single source of truth for a score. Anything that
 * mutates the inputs to a score (payments, delinquencies, utilisation, new
 * inquiries) must route the result through here, so that `currentScore`,
 * `tier` and `scoreFactors` can never drift out of agreement with each other
 * or with what the scorer would return on a live recompute.
 *
 * Regression this guards: `/score` used to serve a stored `currentScore` while
 * `/dual-score` recomputed on the fly, so the same agent could be reported at
 * two different scores — by up to 102 points, wide enough to cross grade
 * boundaries and flip a lending decision.
 */
export function deriveScoreFields(
  raw: Omit<AgentCreditProfile, 'scoreFactors' | 'tier' | 'currentScore'>,
): AgentCreditProfile {
  const { score, factors } = computeScore(raw);
  return {
    ...raw,
    currentScore: score,
    tier:         scoreTierFromScore(score),
    scoreFactors: factors,
  };
}

function seed() {
  const now = new Date().toISOString();

  // NOTE: no `currentScore` here — it is derived by `deriveScoreFields` below.
  // The type deliberately omits it so a hand-written score cannot be
  // reintroduced and silently disagree with the scorer.
  const agents: Omit<AgentCreditProfile, 'scoreFactors' | 'tier' | 'currentScore'>[] = [
    {
      agentId: 'agent_prime_001',
      did: 'did:forge:0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
      evmAddress: '0x7a3b9c2d1e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b',
      operatorEntityId: 'EIN-82-1234567',
      operatorEntityType: 'llc',
      creditHistory: [
        { id: 'evt_001', agentId: 'agent_prime_001', eventType: 'credit_opened', amount: 10000, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Initial credit line opened', timestamp: '2024-01-15T00:00:00Z' },
        { id: 'evt_002', agentId: 'agent_prime_001', eventType: 'payment_on_time', amount: 1200, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Monthly repayment — on time', timestamp: '2024-02-01T00:00:00Z' },
        { id: 'evt_003', agentId: 'agent_prime_001', eventType: 'payment_on_time', amount: 1200, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Monthly repayment — on time', timestamp: '2024-03-01T00:00:00Z' },
        { id: 'evt_004', agentId: 'agent_prime_001', eventType: 'identity_verified', description: 'EIN verified with IRS', timestamp: '2024-01-14T00:00:00Z' },
      ],
      totalDebt: 2400,
      totalCreditLimit: 10000,
      utilizationRate: 0.24,
      paymentHistoryRate: 1.0,
      delinquencies: [],
      hardInquiries: [
        { id: 'inq_001', requestorId: 'lender_aave_v3', requestorName: 'Aave V3', purpose: 'credit_application', timestamp: '2024-01-10T00:00:00Z', consentToken: 'tok_abc123' },
      ],
      createdAt: '2024-01-14T00:00:00Z',
      lastUpdatedAt: now,
    },
    {
      agentId: 'agent_prime_002',
      did: 'did:forge:0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
      evmAddress: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
      operatorEntityId: 'EIN-45-9876543',
      operatorEntityType: 'corp',
      creditHistory: [
        { id: 'evt_010', agentId: 'agent_prime_002', eventType: 'credit_opened', amount: 5000, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Tier-3 credit line', timestamp: '2024-03-01T00:00:00Z' },
        { id: 'evt_011', agentId: 'agent_prime_002', eventType: 'payment_on_time', amount: 800, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'On-time payment', timestamp: '2024-04-01T00:00:00Z' },
        { id: 'evt_012', agentId: 'agent_prime_002', eventType: 'payment_late_30', amount: 800, creditorId: 'fp_internal', contributorId: 'fp_internal', description: '32 days late', timestamp: '2024-05-03T00:00:00Z' },
        { id: 'evt_013', agentId: 'agent_prime_002', eventType: 'payment_on_time', amount: 800, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'On-time payment', timestamp: '2024-06-01T00:00:00Z' },
      ],
      totalDebt: 3200,
      totalCreditLimit: 5000,
      utilizationRate: 0.64,
      paymentHistoryRate: 0.75,
      delinquencies: [],
      hardInquiries: [],
      createdAt: '2024-03-01T00:00:00Z',
      lastUpdatedAt: now,
    },
    {
      agentId: 'agent_subprime_001',
      did: 'did:forge:0x9f8e7d6c5b4a3928172605040302010e0f1a2b3c',
      evmAddress: '0x9f8e7d6c5b4a3928172605040302010e0f1a2b3c',
      operatorEntityId: 'EIN-11-2233445',
      operatorEntityType: 'individual',
      creditHistory: [
        { id: 'evt_020', agentId: 'agent_subprime_001', eventType: 'credit_opened', amount: 2000, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Tier-1 credit line', timestamp: '2024-04-01T00:00:00Z' },
        { id: 'evt_021', agentId: 'agent_subprime_001', eventType: 'payment_late_60', amount: 300, creditorId: 'fp_internal', contributorId: 'fp_internal', description: '62 days late', timestamp: '2024-05-15T00:00:00Z' },
        { id: 'evt_022', agentId: 'agent_subprime_001', eventType: 'payment_late_30', amount: 300, creditorId: 'fp_internal', contributorId: 'fp_internal', description: '35 days late', timestamp: '2024-06-10T00:00:00Z' },
        { id: 'evt_023', agentId: 'agent_subprime_001', eventType: 'payment_on_time', amount: 300, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Recovered — on-time payment', timestamp: '2024-07-08T00:00:00Z' },
        { id: 'evt_024', agentId: 'agent_subprime_001', eventType: 'payment_on_time', amount: 300, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Recovered — on-time payment', timestamp: '2024-08-06T00:00:00Z' },
      ],
      totalDebt: 1800,
      totalCreditLimit: 2000,
      utilizationRate: 0.90,
      // Recovering: 3 of 5 obligations met, but the 62-day delinquency is still
      // open and utilisation is at 90% — a genuine subprime, not a defaulter.
      paymentHistoryRate: 0.55,
      delinquencies: [
        { id: 'del_001', creditorId: 'fp_internal', amount: 300, daysLate: 62, openedAt: '2024-05-15T00:00:00Z', status: 'open' },
      ],
      hardInquiries: [
        { id: 'inq_010', requestorId: 'lender_compound', requestorName: 'Compound V3', purpose: 'credit_application', timestamp: '2024-03-28T00:00:00Z', consentToken: 'tok_xyz789' },
        { id: 'inq_011', requestorId: 'lender_aave_v3', requestorName: 'Aave V3', purpose: 'credit_application', timestamp: '2024-04-02T00:00:00Z', consentToken: 'tok_xyz790' },
      ],
      createdAt: '2024-04-01T00:00:00Z',
      lastUpdatedAt: now,
    },
    {
      agentId: 'agent_super_001',
      did: 'did:forge:0xdeadbeef1234567890abcdef1234567890abcdef',
      evmAddress: '0xdeadbeef1234567890abcdef1234567890abcdef',
      operatorEntityId: 'EIN-99-1111111',
      operatorEntityType: 'dao',
      creditHistory: [
        { id: 'evt_030', agentId: 'agent_super_001', eventType: 'credit_opened', amount: 50000, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Enterprise credit line', timestamp: '2023-06-01T00:00:00Z' },
        { id: 'evt_031', agentId: 'agent_super_001', eventType: 'payment_on_time', amount: 5000, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Monthly repayment', timestamp: '2023-07-01T00:00:00Z' },
        { id: 'evt_032', agentId: 'agent_super_001', eventType: 'payment_on_time', amount: 5000, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Monthly repayment', timestamp: '2023-08-01T00:00:00Z' },
        { id: 'evt_033', agentId: 'agent_super_001', eventType: 'identity_verified', description: 'On-chain DAO vote verified', timestamp: '2023-05-28T00:00:00Z', onChainTxHash: '0xabc123def456' },
      ],
      // Draws 10% of a 50k enterprise line — the disciplined-treasury profile
      // that separates this agent from agent_prime_001 on utilisation alone.
      totalDebt: 5000,
      totalCreditLimit: 50000,
      utilizationRate: 0.10,
      paymentHistoryRate: 1.0,
      delinquencies: [],
      hardInquiries: [],
      createdAt: '2023-05-28T00:00:00Z',
      lastUpdatedAt: now,
    },
    {
      agentId: 'agent_deep_001',
      did: 'did:forge:0x000000000000000000000000000000000000dead',
      evmAddress: '0x000000000000000000000000000000000000dead',
      operatorEntityId: 'EIN-00-0000001',
      operatorEntityType: 'individual',
      creditHistory: [
        { id: 'evt_040', agentId: 'agent_deep_001', eventType: 'credit_opened', amount: 500, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Tier-1 credit line', timestamp: '2024-05-01T00:00:00Z' },
        { id: 'evt_041', agentId: 'agent_deep_001', eventType: 'default', amount: 500, creditorId: 'fp_internal', contributorId: 'fp_internal', description: 'Failed to repay — defaulted', timestamp: '2024-06-15T00:00:00Z' },
        { id: 'evt_042', agentId: 'agent_deep_001', eventType: 'dispute_filed', description: 'Agent filed dispute on default', timestamp: '2024-06-20T00:00:00Z' },
      ],
      totalDebt: 500,
      totalCreditLimit: 500,
      utilizationRate: 1.0,
      paymentHistoryRate: 0.0,
      delinquencies: [
        { id: 'del_010', creditorId: 'fp_internal', amount: 500, daysLate: 90, openedAt: '2024-06-15T00:00:00Z', status: 'open' },
      ],
      hardInquiries: [],
      createdAt: '2024-05-01T00:00:00Z',
      lastUpdatedAt: now,
      frozenAt: '2024-06-16T00:00:00Z',
    },
  ];

  for (const raw of agents) {
    const profile = deriveScoreFields(raw);
    profiles.set(profile.agentId, profile);
  }

  // Seed disputes
  const seedDisputes: Dispute[] = [
    {
      id: 'disp_001',
      agentId: 'agent_deep_001',
      eventId: 'evt_041',
      status: 'investigating',
      filedAt: '2024-06-20T00:00:00Z',
      description: 'Default was due to incorrect creditor reporting — payment was made on 2024-06-14 on-chain.',
      evidence: 'tx_hash_0xabc123...',
      furnisherId: 'fp_internal',
      escalatedAt: undefined,
    },
    {
      id: 'disp_002',
      agentId: 'agent_prime_002',
      eventId: 'evt_012',
      status: 'open',
      filedAt: '2024-05-10T00:00:00Z',
      description: 'Payment was made on 2024-05-02 but recorded as late. Providing bank confirmation.',
      furnisherId: 'fp_internal',
    },
  ];
  for (const d of seedDisputes) disputes.set(d.id, d);

  // Seed contributors.
  // Only the sha256 of each key is stored — the raw values below are the
  // development credentials for the demo furnishers and are documented in
  // .env.example. They authenticate in dev exactly as before; nothing is
  // persisted in plaintext.
  const seedContributors: DataContributor[] = [
    {
      id: 'contrib_aave',
      name: 'Aave V3 Protocol',
      type: 'defi_protocol',
      apiKeyHash: hashApiKey('ck_aave_live_xxx'),
      permissions: ['ingest_events', 'pull_scores'],
      queriesUsed: 12450,
      queriesAllowed: 50000,
      dataRecordsContributed: 284000,
      createdAt: '2024-01-10T00:00:00Z',
      status: 'active',
    },
    {
      id: 'contrib_compound',
      name: 'Compound V3',
      type: 'defi_protocol',
      apiKeyHash: hashApiKey('ck_compound_live_yyy'),
      permissions: ['ingest_events'],
      queriesUsed: 5200,
      queriesAllowed: 20000,
      dataRecordsContributed: 91000,
      createdAt: '2024-02-15T00:00:00Z',
      status: 'active',
    },
    {
      id: 'contrib_openai',
      name: 'OpenAI Platform',
      type: 'saas_platform',
      apiKeyHash: hashApiKey('ck_oai_live_zzz'),
      permissions: ['ingest_events', 'pull_scores'],
      queriesUsed: 890,
      queriesAllowed: 5000,
      dataRecordsContributed: 14000,
      createdAt: '2024-04-01T00:00:00Z',
      status: 'active',
    },
  ];
  for (const c of seedContributors) contributors.set(c.id, c);
}

function scoreTierFromScore(score: number) {
  if (score >= 800) return 'SUPER_PRIME' as const;
  if (score >= 670) return 'PRIME' as const;
  if (score >= 580) return 'NEAR_PRIME' as const;
  if (score >= 500) return 'SUBPRIME' as const;
  return 'DEEP_SUBPRIME' as const;
}

// No-DB path: seed the in-memory maps at module load exactly as before.
// When a database IS configured, seeding is handled by initPersistence()
// (seed-if-empty, else hydrate) so we don't clobber persisted state.
if (!isDbEnabled()) seed();

/**
 * Bring the store online against Postgres when a database is configured.
 * Called once at service startup (index.ts main). Idempotent.
 *   • runs migrations
 *   • hydrates the in-memory read-model from persisted rows
 *   • on a fresh/empty database, seeds demo data and writes it through
 * When no database is configured this is a no-op (module load already seeded).
 */
export async function initPersistence(): Promise<void> {
  if (!isDbEnabled()) return;

  await runMigrations();

  const [ps, ds, rs, cs, ls, bas, bts, tus] = await Promise.all([
    loadAllProfiles(), loadAllDisputes(), loadAllReports(), loadAllContributors(),
    loadAllLenderReports(), loadAllBillingAccounts(), loadAllBillingTransactions(),
    loadAllTopUpReceipts(),
  ]);

  if (ps.length === 0) {
    // Fresh database — seed in memory, then persist the seed. Billing starts
    // empty on a fresh database — there is nothing to seed there, accounts
    // are created lazily on first credit/debit.
    seed();
    await Promise.all([
      ...Array.from(profiles.values()).map((p) => upsertProfile(p).catch(persistErr('profile'))),
      ...Array.from(disputes.values()).map((d) => upsertDispute(d).catch(persistErr('dispute'))),
      ...Array.from(reports.values()).map((r) => upsertReport(r).catch(persistErr('report'))),
      ...Array.from(contributors.values()).map((c) => upsertContributor(c).catch(persistErr('contributor'))),
    ]);
    console.log(`[credit-bureau] seeded fresh database with ${profiles.size} agent profiles`);
  } else {
    // Existing database — hydrate the read-model from persisted rows.
    profiles.clear();     ps.forEach((p) => profiles.set(p.agentId, p));
    disputes.clear();     ds.forEach((d) => disputes.set(d.id, d));
    reports.clear();      rs.forEach((r) => reports.set(r.reportId, r));
    contributors.clear(); cs.forEach((c) => contributors.set(c.id, c));
    lenderReports.clear(); ls.forEach((r) => lenderReports.set(r.reportId, r));
    console.log(`[credit-bureau] hydrated ${profiles.size} profiles, ${disputes.size} disputes from database`);
  }

  // Billing hydrates unconditionally, independent of the profile-seed branch
  // above — money must never be re-seeded or dropped on restart.
  billingAccounts.clear();     bas.forEach((a) => billingAccounts.set(a.requestorId, a));
  billingTransactions.clear(); bts.forEach((t) => billingTransactions.set(t.id, t));
  topUpReceipts.clear();       tus.forEach((r) => topUpReceipts.set(r.receiptId, r));
  console.log(`[credit-bureau] hydrated ${billingAccounts.size} billing accounts, ${billingTransactions.size} ledger entries`);
}
