-- Settlement instructions from treasury are recorded here and executed by an
-- operator; no payment rail is connected. method / invoiceRefs were only held
-- in memory before (and lost on restart).
ALTER TABLE "InternalTransfer" ADD COLUMN IF NOT EXISTS "method"      TEXT;
ALTER TABLE "InternalTransfer" ADD COLUMN IF NOT EXISTS "invoiceRefs" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "InternalTransfer" ADD COLUMN IF NOT EXISTS "executedBy"  TEXT;
ALTER TABLE "InternalTransfer" ADD COLUMN IF NOT EXISTS "executedAt"  TIMESTAMPTZ;
