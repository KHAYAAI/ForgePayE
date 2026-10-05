import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { screenName, type ScreeningConfig, type ScreeningResult } from './sanctions-screen.js';
import { decisionForCheckResult, fetchCheckResult } from './onfido.js';

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
    private readonly screening: ScreeningConfig = {
      baseUrl: undefined, apiKey: undefined, maxAgeHours: 48, matchScore: 0.95, searchThreshold: 0.85,
    },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async submitKyc(req: KycSubmissionRequest): Promise<KycVerification> {
    // Sanctions screening first.
    const screen = await this.screenForSanctions(req.firstName, req.lastName, req.address.country);
    const ofacMatch = screen.outcome === 'match';
    const pepMatch = false; // no PEP source is integrated; see sanctions-screen.ts

    if (ofacMatch) {
      const verificationId = randomUUID();
      await this.db.query(
        `INSERT INTO fp_kyc_verifications
           (id, account_id, status, risk_score, ofac_match, pep_match, rejection_reason,
            first_name, last_name, date_of_birth, country, completed_at)
         VALUES ($1,$2,'rejected',1.0,$3,$4,'Sanctions match',$5,$6,$7,$8,now())`,
        [verificationId, req.accountId, ofacMatch, pepMatch,
         req.firstName, req.lastName, req.dateOfBirth, req.address.country],
      );
      await this.recordScreening(verificationId, screen);
      await this.db.query(
        `UPDATE fp_accounts SET kyc_status='rejected', risk_score=1.0 WHERE id=$1`, [req.accountId],
      );
      const result = await this.db.query(`SELECT * FROM fp_kyc_verifications WHERE id=$1`, [verificationId]);
      return toRecord(result.rows[0] as Record<string, unknown>);
    }

    let riskScore = this.computeRiskScore(req.address.country, ofacMatch, pepMatch);
    let status: KycStatus = 'pending';
    // Anything short of a clear screen is for a person to decide. Identity
    // verification still runs, but nothing below may approve this applicant.
    const screenedClear = screen.outcome === 'clear'
      || (screen.outcome === 'not_screened' && process.env['NODE_ENV'] !== 'production');
    let onfidoApplicantId: string | undefined;
    let onfidoCheckId: string | undefined;
    let completedAt: string | undefined;

    if (!this.onfidoApiKey) {
      // Fail closed in production. config.ts already requires ONFIDO_API_KEY
      // there, but the check is repeated at the decision point because this is
      // where an applicant is actually granted approved status — a
      // misconfiguration must never be able to express itself as a verified
      // identity. Verification cannot be skipped simply because the verifier
      // is missing.
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error(
          'ONFIDO_API_KEY is not configured. Refusing to approve KYC without ' +
          'identity verification — an unverified applicant must not be recorded ' +
          'as approved.',
        );
      }

      // Development only: no verification provider, so approve and say so
      // loudly. Never reachable in production because of the throw above.
      console.warn('[kyc] ONFIDO_API_KEY not set — auto-approving KYC in dev mode');
      status      = screenedClear ? 'approved' : 'requires_review';
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
      if (!screenedClear) status = 'requires_review';
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

    await this.recordScreening(verificationId, screen);

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
    _country:  string,
  ): Promise<ScreeningResult> {
    if (!this.ofacEnabled) {
      // Allowed in development only; in production this is unavailable and
      // nobody is approved on it.
      return process.env['NODE_ENV'] === 'production'
        ? { outcome: 'unavailable', detail: 'sanctions screening is disabled', matches: [] }
        : { outcome: 'not_screened', detail: 'sanctions screening disabled (development)', matches: [] };
    }
    return screenName(`${firstName} ${lastName}`.trim(), this.screening, this.fetchImpl);
  }

  private async recordScreening(verificationId: string, screen: ScreeningResult): Promise<void> {
    await this.db.query(
      `UPDATE fp_kyc_verifications SET sanctions_outcome=$1, sanctions_detail=$2 WHERE id=$3`,
      [screen.outcome, screen.detail, verificationId],
    );
  }

  /**
   * Onfido `check.completed`. The body says the check finished, not how; the
   * result is read from Onfido. Only a `clear` check on an applicant whose
   * sanctions screen was clear approves. The caller verifies the signature.
   */
  async handleOnfidoWebhook(body: Record<string, unknown>): Promise<void> {
    const payload = (body['payload'] ?? body) as Record<string, unknown>;
    if (payload['resource_type'] !== 'check' || payload['action'] !== 'check.completed') return;
    const checkId = (payload['object'] as Record<string, unknown> | undefined)?.['id'] as string | undefined;
    if (!checkId || !this.onfidoApiKey) return;

    const row = await this.db.query(
      `SELECT id, account_id, sanctions_outcome FROM fp_kyc_verifications WHERE onfido_check_id=$1`, [checkId],
    );
    if (row.rows.length === 0) return;
    const { id, account_id, sanctions_outcome } = row.rows[0] as Record<string, unknown>;

    const check = await fetchCheckResult(checkId, this.onfidoApiKey, undefined, this.fetchImpl);
    let status: KycStatus = decisionForCheckResult(check.result);
    const screenedClear = sanctions_outcome === 'clear'
      || (sanctions_outcome === 'not_screened' && process.env['NODE_ENV'] !== 'production');
    if (status === 'approved' && !screenedClear) status = 'requires_review';

    await this.db.query(
      `UPDATE fp_kyc_verifications SET status=$1, completed_at=now(), raw_response=$2 WHERE id=$3`,
      [status, JSON.stringify({ onfido_check: check }), id],
    );
    await this.db.query(
      `UPDATE fp_accounts SET kyc_status=$1, updated_at=now() WHERE id=$2`,
      [status, account_id],
    );
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
        // Documents and the selfie are uploaded by the applicant through
        // Onfido's SDK; Onfido uses whatever has been uploaded. (The UK-only
        // right_to_work report and an empty document_ids list were removed.)
        report_names: ['document', 'facial_similarity_photo'],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Onfido check error: ${res.status}`);
    return res.json() as Promise<{ id: string }>;
  }
}
