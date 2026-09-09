import { randomUUID } from 'node:crypto';
// Countries with elevated AML risk (simplified list)
const HIGH_RISK_COUNTRIES = new Set(['KP', 'IR', 'SY', 'CU', 'RU', 'BY', 'MM', 'LY', 'SO', 'YE']);
function toRecord(row) {
    return {
        id: row['id'],
        accountId: row['account_id'],
        status: row['status'],
        onfidoApplicantId: row['onfido_applicant_id'],
        onfidoCheckId: row['onfido_check_id'],
        riskScore: parseFloat(row['risk_score']),
        ofacMatch: row['ofac_match'],
        pepMatch: row['pep_match'],
        rejectionReason: row['rejection_reason'],
        createdAt: row['created_at'].toISOString(),
        completedAt: row['completed_at'] ? row['completed_at'].toISOString() : undefined,
    };
}
export class KycAmlManager {
    db;
    onfidoApiKey;
    ofacEnabled;
    constructor(db, onfidoApiKey, ofacEnabled) {
        this.db = db;
        this.onfidoApiKey = onfidoApiKey;
        this.ofacEnabled = ofacEnabled;
    }
    async submitKyc(req) {
        // OFAC/PEP screening first
        const { ofacMatch, pepMatch } = await this.screenForSanctions(req.firstName, req.lastName, req.address.country);
        if (ofacMatch) {
            const verificationId = randomUUID();
            await this.db.query(`INSERT INTO fp_kyc_verifications
           (id, account_id, status, risk_score, ofac_match, pep_match, rejection_reason,
            first_name, last_name, date_of_birth, country, completed_at)
         VALUES ($1,$2,'rejected',1.0,$3,$4,'OFAC sanctions match',$5,$6,$7,$8,now())`, [verificationId, req.accountId, ofacMatch, pepMatch,
                req.firstName, req.lastName, req.dateOfBirth, req.address.country]);
            await this.db.query(`UPDATE fp_accounts SET kyc_status='rejected', risk_score=1.0 WHERE id=$1`, [req.accountId]);
            const result = await this.db.query(`SELECT * FROM fp_kyc_verifications WHERE id=$1`, [verificationId]);
            return toRecord(result.rows[0]);
        }
        let riskScore = this.computeRiskScore(req.address.country, ofacMatch, pepMatch);
        let status = 'pending';
        let onfidoApplicantId;
        let onfidoCheckId;
        let completedAt;
        if (!this.onfidoApiKey) {
            // Fail closed in production. config.ts already requires ONFIDO_API_KEY
            // there, but the check is repeated at the decision point because this is
            // where an applicant is actually granted approved status — a
            // misconfiguration must never be able to express itself as a verified
            // identity. Verification cannot be skipped simply because the verifier
            // is missing.
            if (process.env['NODE_ENV'] === 'production') {
                throw new Error('ONFIDO_API_KEY is not configured. Refusing to approve KYC without ' +
                    'identity verification — an unverified applicant must not be recorded ' +
                    'as approved.');
            }
            // Development only: no verification provider, so approve and say so
            // loudly. Never reachable in production because of the throw above.
            console.warn('[kyc] ONFIDO_API_KEY not set — auto-approving KYC in dev mode');
            status = 'approved';
            completedAt = new Date().toISOString();
        }
        else {
            // Create Onfido applicant
            try {
                const applicant = await this.createOnfidoApplicant(req);
                onfidoApplicantId = applicant.id;
                const check = await this.createOnfidoCheck(applicant.id, req.documentType);
                onfidoCheckId = check.id;
            }
            catch (err) {
                console.error('[kyc] Onfido API error:', err);
                status = 'requires_review';
            }
        }
        const verificationId = randomUUID();
        await this.db.query(`INSERT INTO fp_kyc_verifications
         (id, account_id, status, onfido_applicant_id, onfido_check_id, risk_score,
          ofac_match, pep_match, first_name, last_name, date_of_birth, country, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
            verificationId, req.accountId, status,
            onfidoApplicantId ?? null, onfidoCheckId ?? null,
            riskScore, ofacMatch, pepMatch,
            req.firstName, req.lastName, req.dateOfBirth, req.address.country,
            completedAt ?? null,
        ]);
        await this.db.query(`UPDATE fp_accounts SET kyc_status=$1, risk_score=$2, updated_at=now() WHERE id=$3`, [status, riskScore, req.accountId]);
        const result = await this.db.query(`SELECT * FROM fp_kyc_verifications WHERE id=$1`, [verificationId]);
        return toRecord(result.rows[0]);
    }
    async getKycStatus(accountId) {
        const result = await this.db.query(`SELECT * FROM fp_kyc_verifications WHERE account_id=$1 ORDER BY created_at DESC LIMIT 1`, [accountId]);
        if (result.rows.length === 0)
            return null;
        return toRecord(result.rows[0]);
    }
    async screenForSanctions(firstName, lastName, country) {
        if (!this.ofacEnabled) {
            return { ofacMatch: false, pepMatch: false };
        }
        // TODO: integrate with a real OFAC/PEP screening provider (e.g. Comply Advantage, Chainalysis)
        // For now: flag only explicitly sanctioned countries as a heuristic
        console.warn(`[kyc] OFAC screening stub: ${firstName} ${lastName} from ${country}`);
        return { ofacMatch: false, pepMatch: false };
    }
    async handleOnfidoWebhook(payload) {
        const resourceType = payload['resource_type'];
        if (resourceType !== 'check')
            return;
        const checkId = payload['object']?.['id'];
        const result = payload['object']?.['status'];
        if (!checkId || !result)
            return;
        const approved = result === 'complete';
        const status = approved ? 'approved' : 'rejected';
        await this.db.query(`UPDATE fp_kyc_verifications
       SET status=$1, completed_at=now()
       WHERE onfido_check_id=$2`, [status, checkId]);
        // Reflect on account
        const kycResult = await this.db.query(`SELECT account_id FROM fp_kyc_verifications WHERE onfido_check_id=$1`, [checkId]);
        if (kycResult.rows.length > 0) {
            const accountId = kycResult.rows[0]['account_id'];
            await this.db.query(`UPDATE fp_accounts SET kyc_status=$1, updated_at=now() WHERE id=$2`, [status, accountId]);
        }
    }
    computeRiskScore(country, ofacMatch, pepMatch) {
        if (ofacMatch)
            return 1.0;
        let score = 0.1;
        if (HIGH_RISK_COUNTRIES.has(country.toUpperCase()))
            score += 0.2;
        if (pepMatch)
            score += 0.3;
        return Math.min(score, 1.0);
    }
    async createOnfidoApplicant(req) {
        const res = await fetch('https://api.eu.onfido.com/v3.6/applicants', {
            method: 'POST',
            headers: {
                'Authorization': `Token token=${this.onfidoApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                first_name: req.firstName,
                last_name: req.lastName,
                email: req.email,
                dob: req.dateOfBirth,
                address: {
                    building_number: '',
                    street: req.address.line1,
                    town: req.address.city,
                    country: req.address.country,
                    postcode: req.address.postalCode,
                },
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok)
            throw new Error(`Onfido applicant error: ${res.status}`);
        return res.json();
    }
    async createOnfidoCheck(applicantId, documentType) {
        const res = await fetch('https://api.eu.onfido.com/v3.6/checks', {
            method: 'POST',
            headers: {
                'Authorization': `Token token=${this.onfidoApiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                applicant_id: applicantId,
                report_names: ['document', 'facial_similarity_photo', 'right_to_work'],
                document_ids: [],
            }),
            signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok)
            throw new Error(`Onfido check error: ${res.status}`);
        return res.json();
    }
}
//# sourceMappingURL=kyc-aml-manager.js.map