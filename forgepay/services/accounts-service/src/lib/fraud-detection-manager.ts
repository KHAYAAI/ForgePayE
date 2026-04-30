import type { Pool } from 'pg';

export interface FraudAssessment {
  transactionId: string;
  accountId:     string;
  riskScore:     number;
  riskLevel:     'low' | 'medium' | 'high' | 'blocked';
  riskFactors:   string[];
  decision:      'allow' | 'review' | 'block';
  assessedAt:    string;
}

export interface TransactionContext {
  transactionId:          string;
  accountId:              string;
  amountUsd:              number;
  chain:                  string;
  destinationAddress?:    string;
  ipAddress?:             string;
  userAgent?:             string;
  velocityCheckMinutes?:  number;
}

export class FraudDetectionManager {
  constructor(private readonly db: Pool) {}

  async assess(ctx: TransactionContext): Promise<FraudAssessment> {
    const factors: string[]  = [];
    let score = 0.0;
    const lookbackMinutes = ctx.velocityCheckMinutes ?? 1440; // default 24h

    // 1. Amount thresholds
    if (ctx.amountUsd > 50_000) {
      score += 0.4;
      factors.push('very_large_amount');
    } else if (ctx.amountUsd > 10_000) {
      score += 0.2;
      factors.push('large_amount');
    }

    // 2. Velocity check
    const velocityResult = await this.db.query(
      `SELECT COUNT(*) AS cnt FROM fp_account_transactions
       WHERE account_id = $1 AND created_at > now() - $2::interval AND status != 'blocked'`,
      [ctx.accountId, `${lookbackMinutes} minutes`],
    );
    const txCount = parseInt((velocityResult.rows[0] as Record<string, unknown>)['cnt'] as string, 10);
    if (txCount > 10) {
      score += 0.3;
      factors.push('high_velocity');
    } else if (txCount > 5) {
      score += 0.15;
      factors.push('elevated_velocity');
    }

    // 3. Account age
    const ageResult = await this.db.query(
      `SELECT EXTRACT(epoch FROM (now() - created_at)) / 86400 AS age_days FROM fp_accounts WHERE id = $1`,
      [ctx.accountId],
    );
    if (ageResult.rows.length > 0) {
      const ageDays = parseFloat((ageResult.rows[0] as Record<string, unknown>)['age_days'] as string);
      if (ageDays < 7) {
        score += 0.1;
        factors.push('new_account');
      }
    }

    // 4. Round number heuristic
    if (ctx.amountUsd > 0 && ctx.amountUsd % 100 === 0) {
      score += 0.05;
      factors.push('round_amount');
    }

    // 5. KYC status
    const kycResult = await this.db.query(
      `SELECT kyc_status FROM fp_accounts WHERE id = $1`, [ctx.accountId],
    );
    if (kycResult.rows.length > 0) {
      const kycStatus = (kycResult.rows[0] as Record<string, unknown>)['kyc_status'] as string;
      if (kycStatus !== 'approved') {
        score += 0.25;
        factors.push('kyc_not_approved');
      }
    }

    score = Math.min(score, 1.0);

    const riskLevel: FraudAssessment['riskLevel'] =
      score >= 0.8 ? 'blocked' :
      score >= 0.6 ? 'high'    :
      score >= 0.3 ? 'medium'  : 'low';

    const decision: FraudAssessment['decision'] =
      score >= 0.8 ? 'block'  :
      score >= 0.3 ? 'review' : 'allow';

    return {
      transactionId: ctx.transactionId,
      accountId:     ctx.accountId,
      riskScore:     parseFloat(score.toFixed(3)),
      riskLevel,
      riskFactors:   factors,
      decision,
      assessedAt:    new Date().toISOString(),
    };
  }

  async recordOutcome(transactionId: string, outcome: 'confirmed' | 'failed' | 'reversed'): Promise<void> {
    // In production: feed into ML model for continuous learning
    // For now: log the outcome for audit trail
    console.info(`[fraud] Transaction ${transactionId} outcome: ${outcome}`);
  }
}
