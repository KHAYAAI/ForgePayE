import { describe, expect, it } from 'vitest';
import { creditGrade, gradeDistribution, INQUIRY_FEE_USD } from './grade';
import { verifyAgent, sanctionsScreen } from './verify';
import type { AgentCreditProfile } from './types';

describe('creditGrade — AAA–D scale', () => {
  it('maps band boundaries to the published Qova scale', () => {
    expect(creditGrade(1000).grade).toBe('AAA');
    expect(creditGrade(950).grade).toBe('AAA');
    expect(creditGrade(949).grade).toBe('AA');
    expect(creditGrade(900).grade).toBe('AA');
    expect(creditGrade(850).grade).toBe('A');
    expect(creditGrade(750).grade).toBe('BBB');
    expect(creditGrade(650).grade).toBe('BB');
    expect(creditGrade(550).grade).toBe('B');
    expect(creditGrade(450).grade).toBe('CCC');
    expect(creditGrade(350).grade).toBe('CC');
    expect(creditGrade(250).grade).toBe('C');
    expect(creditGrade(249).grade).toBe('D');
    expect(creditGrade(0).grade).toBe('D');
  });

  it('marks BBB and above as investment grade', () => {
    expect(creditGrade(750).investmentGrade).toBe(true);
    expect(creditGrade(749).investmentGrade).toBe(false);
  });

  it('clamps out-of-range scores', () => {
    expect(creditGrade(-50).grade).toBe('D');
    expect(creditGrade(1500).grade).toBe('AAA');
  });

  it('distributes scores across grades', () => {
    const dist = gradeDistribution([980, 920, 760, 660, 100]);
    expect(dist.AAA).toBe(1);
    expect(dist.AA).toBe(1);
    expect(dist.BBB).toBe(1);
    expect(dist.BB).toBe(1);
    expect(dist.D).toBe(1);
  });

  it('meters inquiries at $2.80', () => {
    expect(INQUIRY_FEE_USD).toBe(2.8);
  });
});

function makeProfile(overrides: Partial<AgentCreditProfile> = {}): AgentCreditProfile {
  const yearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  return {
    agentId: 'agent_test',
    did: 'did:forge:agent_test',
    operatorEntityId: 'EIN-11-1111111',
    operatorEntityType: 'llc',
    currentScore: 780,
    tier: 'PRIME',
    scoreFactors: [],
    creditHistory: Array.from({ length: 6 }, (_, i) => ({
      id: `evt_${i}`,
      agentId: 'agent_test',
      eventType: 'payment_on_time' as const,
      description: 'on-time payment',
      timestamp: yearAgo,
    })),
    totalDebt: 0,
    totalCreditLimit: 50_000,
    utilizationRate: 0,
    paymentHistoryRate: 1,
    delinquencies: [],
    hardInquiries: [],
    createdAt: yearAgo,
    lastUpdatedAt: yearAgo,
    ...overrides,
  };
}

describe('verifyAgent — 8 checks', () => {
  it('returns VERIFIED when all checks pass', async () => {
    const result = await verifyAgent(makeProfile());
    expect(result.checksTotal).toBe(8);
    expect(result.checksPassed).toBe(8);
    expect(result.status).toBe('VERIFIED');
    expect(result.grade.grade).toBe('BBB');
  });

  it('returns SUSPICIOUS on sanctions exposure regardless of other checks', async () => {
    const result = await verifyAgent(makeProfile({ frozenAt: '2026-06-28' }));
    expect(result.status).toBe('SUSPICIOUS');
  });

  it('returns PARTIALLY_VERIFIED when a minor check fails', async () => {
    const result = await verifyAgent(makeProfile({ currentScore: 480, creditHistory: [] }));
    // fails minimum_score + activity_level → 6 of 8
    expect(result.checksPassed).toBe(6);
    expect(result.status).toBe('PARTIALLY_VERIFIED');
  });

  it('sanctions screen flags recorded hits', async () => {
    const profile = makeProfile();
    profile.creditHistory.push({
      id: 'evt_sx',
      agentId: 'agent_test',
      eventType: 'sanctions_hit',
      description: 'OFAC list match',
      timestamp: new Date().toISOString(),
    });
    const screen = await sanctionsScreen(profile);
    expect(screen.clear).toBe(false);
    expect(screen.hits).toBe(1);
  });
});
