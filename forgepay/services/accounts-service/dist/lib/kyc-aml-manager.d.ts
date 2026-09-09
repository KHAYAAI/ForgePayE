import type { Pool } from 'pg';
export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'requires_review';
export interface KycVerification {
    id: string;
    accountId: string;
    status: KycStatus;
    onfidoApplicantId?: string;
    onfidoCheckId?: string;
    riskScore: number;
    ofacMatch: boolean;
    pepMatch: boolean;
    rejectionReason?: string;
    createdAt: string;
    completedAt?: string;
}
export interface KycSubmissionRequest {
    accountId: string;
    firstName: string;
    lastName: string;
    email: string;
    dateOfBirth: string;
    address: {
        line1: string;
        city: string;
        country: string;
        postalCode: string;
    };
    documentType?: 'passport' | 'driving_licence' | 'national_identity_card';
}
export declare class KycAmlManager {
    private readonly db;
    private readonly onfidoApiKey;
    private readonly ofacEnabled;
    constructor(db: Pool, onfidoApiKey: string | undefined, ofacEnabled: boolean);
    submitKyc(req: KycSubmissionRequest): Promise<KycVerification>;
    getKycStatus(accountId: string): Promise<KycVerification | null>;
    screenForSanctions(firstName: string, lastName: string, country: string): Promise<{
        ofacMatch: boolean;
        pepMatch: boolean;
    }>;
    handleOnfidoWebhook(payload: Record<string, unknown>): Promise<void>;
    private computeRiskScore;
    private createOnfidoApplicant;
    private createOnfidoCheck;
}
//# sourceMappingURL=kyc-aml-manager.d.ts.map