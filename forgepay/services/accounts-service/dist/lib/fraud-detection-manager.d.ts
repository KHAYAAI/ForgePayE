import type { Pool } from 'pg';
export interface FraudAssessment {
    transactionId: string;
    accountId: string;
    riskScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'blocked';
    riskFactors: string[];
    decision: 'allow' | 'review' | 'block';
    assessedAt: string;
}
export interface TransactionContext {
    transactionId: string;
    accountId: string;
    amountUsd: number;
    chain: string;
    destinationAddress?: string;
    ipAddress?: string;
    userAgent?: string;
    velocityCheckMinutes?: number;
}
export declare class FraudDetectionManager {
    private readonly db;
    constructor(db: Pool);
    assess(ctx: TransactionContext): Promise<FraudAssessment>;
    recordOutcome(transactionId: string, outcome: 'confirmed' | 'failed' | 'reversed'): Promise<void>;
}
//# sourceMappingURL=fraud-detection-manager.d.ts.map