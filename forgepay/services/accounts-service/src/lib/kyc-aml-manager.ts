import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export type KycStatus = 'not_started' | 'pending' | 'approved' | 'rejected' | 'requires_review';

export interface KycVerification {
  id:                  string;
  accountId:           string;
  status:              KycStatus;
  onfidoApplicantId?:  string;
  onfidoCheckId?:      string;
  riskScore:           number;
  ofacMatch:           boolean;
  pepMatch:            boolean;
  rejectionReason?:    string;
  createdAt:           string;
  completedAt?:        string;
}

export interface KycSubmissionRequest {
  accountId:    string;
  firstName:    string;
  lastName:     string;
  email:        string;
  dateOfBirth:  string;
  address: {
    line1:      string;
    city:       string;
    country:    string;  // ISO 3166-1 alpha-2
    postalCode: string;
  };
  documentType?: 'passport' | 'driving_licence' | 'national_identity_card';
}

// Countries with elevated AML risk (simplified list)
const HIGH_RISK_COUNTRIES = new Set(['KP', 'IR', 'SY', 'CU', 'RU', 'BY', 'MM', 'LY', 'SO', 'YE']);

function toRecord(row: Record<string, unknown>): KycVerification {
  return {
    id:                 row['id'] as string,
    accountId:          row['account_id'] as string,
    status:             row['status'] as KycStatus,
    onfidoApplicantId:  row['onfido_applicant_id'] as string | undefined,
    onfidoCheckId:      row['onfido_check_id'] as string | undefined,
    riskScore:          parseFloat(row['risk_score'] as string),
    ofacMatch:          row['ofac_match'] as boolean,
    pepMatch:           row['pep_match'] as boolean,
    rejectionReason:    row['rejection_reason'] as string | undefined,
    createdAt:          (row['created_at'] as Date).toISOString(),
    completedAt:        row['completed_at'] ? (row['completed_at'] as Date).toISOString() : undefined,
  };
}

export class KycAmlManager {
  constructor(
    private readonly db: Pool,
    private readonly onfidoApiKey: string | undefined,
    private readonly ofacEnabled: boolean,
  ) {}

  async submitKyc(req: KycSubmissionRequest): Promise<KycVerification> {
    // OFAC/PEP screening first
    const { ofacMatch, pepMatch } = await this.screenForSanctions(
      req.firstName,
      req.lastName,
      req.address.country,
    );

    if (ofacMatch) {
      const verificationId = randomUUID();
      await this.db.query(
        `INSERT INTO fp_kyc_verifications
           (id, account_id, status, risk_score, ofac_match, pep_match, rejection_reason,
            first_name, last_name, date_of_birth, country, completed_at)
         VALUES ($1,$2,'rejected',1.0,$3,$4,'OFAC sanctions match',$5,$6,$7,$8,now())`,
        [verificationId, req.accountId, ofacMatch, pepMatch,
         req.firstName, req.lastName, req.dateOfBirth, req.address.country],
      );
      await this.db.query(
        `UPDATE fp_accounts SET kyc_status='rejected', risk_score=1.0 WHERE id=$1`, [req.accountId],
      );
      const result = await this.db.query(`SELECT * FROM fp_kyc_verifications WHERE id=$1`, [verificationId]);
      return toRecord(result.rows[0] as Record<string, unknown>);
    }

    let riskScore = this.computeRiskScore(req.address.country, ofacMatch, pepMatch);
    let status: KycStatus = 'pending';
    let onfidoApplicantId: string | undefined;
    let onfidoCheckId: string | undefined;
    let completedAt: string | undefined;

    if (!this.onfidoApiKey) {
      // Dev mode: auto-approve
      console.warn('[kyc] ONFIDO_API_KEY not set — auto-approving KYC in dev mode');
      status      = 'approved';
      completedAt = new Date().toISOString();
    } else {
      // Create Onfido applicant
      try {
        const applicant = await this.createOnfidoApplicant(req);
        onfidoApplicantId = applicant.id;

        const check = await this.createOnfidoCheck(applicant.id, req.documentType);
        onfidoCheckId = check.id;
      } catch (err) {
        console.error('[kyc] Onfido API error:', err);
        status = 'requires_review';
      }
    }

    const verificationId = randomUUID();
    await this.db.query(
      `INSERT INTO fp_kyc_verifications
         (id, account_id, status, onfido_applicant_id, onfido_check_id, risk_score,
          ofac_match, pep_match, first_name, last_name, date_of_birth, country, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        verificationId, req.accountId, status,
        onfidoApplicantId ?? null, onfidoCheckId ?? null,
        riskScore, ofacMatch, pepMatch,
        req.firstName, req.lastName, req.dateOfBirth, req.address.country,
        completedAt ?? null,
      ],
    );

    await this.db.query(
      `UPDATE fp_accounts SET kyc_status=$1, risk_score=$2, updated_at=now() WHERE id=$3`,
      [status, riskScore, req.accountId],
    );

    const result = await this.db.query(`SELECT * FROM fp_kyc_verifications WHERE id=$1`, [verificationId]);
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async getKycStatus(accountId: string): Promise<KycVerification | null> {
    const result = await this.db.query(
      `SELECT * FROM fp_kyc_verifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1`,
      [accountId],
    );
    if (result.rows.length === 0) return null;
    return toRecord(result.rows[0] as Record<string, unknown>);
  }

  async screenForSanctions(
    firstName: string,
    lastName:  string,
    country:   string,
  ): Promise<{ ofacMatch: boolean; pepMatch: boolean }> {
    if (!this.ofacEnabled) {
      return { ofacMatch: false, pepMatch: false };
    }
    // TODO: integrate with a real OFAC/PEP screening provider (e.g. Comply Advantage, Chainalysis)
    // For now: flag only explicitly sanctioned countries as a heuristic
    console.warn(`[kyc] OFAC screening stub: ${firstName} ${lastName} from ${country}`);
    return { ofacMatch: false, pepMatch: false };
  }

  async handleOnfidoWebhook(payload: Record<string, unknown>): Promise<void> {
    const resourceType = payload['resource_type'] as string;
    if (resourceType !== 'check') return;

    const checkId = (payload['object'] as Record<string, unknown>)?.['id'] as string;
    const result  = (payload['object'] as Record<string, unknown>)?.['status'] as string;
    if (!checkId || !result) return;

    const approved = result === 'complete';
    const status: KycStatus = approved ? 'approved' : 'rejected';

    await this.db.query(
      `UPDATE fp_kyc_verifications
       SET status=$1, completed_at=now()
       WHERE onfido_check_id=$2`,
      [status, checkId],
    );

    // Reflect on account
    const kycResult = await this.db.query(
      `SELECT account_id FROM fp_kyc_verifications WHERE onfido_check_id=$1`, [checkId],
    );
    if (kycResult.rows.length > 0) {
      const accountId = (kycResult.rows[0] as Record<string, unknown>)['account_id'];
      await this.db.query(
        `UPDATE fp_accounts SET kyc_status=$1, updated_at=now() WHERE id=$2`,
        [status, accountId],
      );
    }
  }

  private computeRiskScore(country: string, ofacMatch: boolean, pepMatch: boolean): number {
    if (ofacMatch) return 1.0;
    let score = 0.1;
    if (HIGH_RISK_COUNTRIES.has(country.toUpperCase())) score += 0.2;
    if (pepMatch) score += 0.3;
    return Math.min(score, 1.0);
  }

  private async createOnfidoApplicant(req: KycSubmissionRequest): Promise<{ id: string }> {
    const res = await fetch('https://api.eu.onfido.com/v3.6/applicants', {
      method:  'POST',
      headers: {
        'Authorization': `Token token=${this.onfidoApiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        first_name:    req.firstName,
        last_name:     req.lastName,
        email:         req.email,
        dob:           req.dateOfBirth,
        address: {
          building_number: '',
          street:          req.address.line1,
          town:            req.address.city,
          country:         req.address.country,
          postcode:        req.address.postalCode,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Onfido applicant error: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }

  private async createOnfidoCheck(applicantId: string, documentType?: string): Promise<{ id: string }> {
    const res = await fetch('https://api.eu.onfido.com/v3.6/checks', {
      method:  'POST',
      headers: {
        'Authorization': `Token token=${this.onfidoApiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        applicant_id: applicantId,
        report_names: ['document', 'facial_similarity_photo', 'right_to_work'],
        document_ids: [],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Onfido check error: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }
}
