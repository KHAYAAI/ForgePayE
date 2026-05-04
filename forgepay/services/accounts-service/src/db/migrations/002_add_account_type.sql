-- Add custodial vs self_custodial account type support
-- Allows ForgePay to manage keys (custodial) or users to manage keys (self_custodial)

ALTER TABLE fp_accounts
  ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT 'self_custodial'
    CHECK (account_type IN ('custodial', 'self_custodial'));

-- For custodial accounts: AWS KMS CMK ARN
ALTER TABLE fp_accounts
  ADD COLUMN kms_key_id VARCHAR(255);

-- Indexes
CREATE INDEX ix_fp_accounts_account_type ON fp_accounts(account_type);
CREATE INDEX ix_fp_accounts_kms_key_id ON fp_accounts(kms_key_id) WHERE account_type = 'custodial';
