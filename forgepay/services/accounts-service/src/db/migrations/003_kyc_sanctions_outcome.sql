-- Record what sanctions screening actually concluded for each KYC submission,
-- so an Onfido "clear" can only approve someone whose screening was clear too.
ALTER TABLE fp_kyc_verifications ADD COLUMN IF NOT EXISTS sanctions_outcome TEXT;
ALTER TABLE fp_kyc_verifications ADD COLUMN IF NOT EXISTS sanctions_detail TEXT;
