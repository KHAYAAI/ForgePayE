-- Migration 002: Comprehensive Index Optimization and Monitoring Configuration
-- ═════════════════════════════════════════════════════════════════════════════════
-- This migration adds critical indexes across all ForgePay services' tables
-- to eliminate N+1 query patterns and optimize common access patterns.
--
-- Performance improvements:
--   - Foreign key lookups (vault_id, merchant_id, agent_id) → indexed
--   - Compound indexes for time-series queries (merchant_id, created_at DESC)
--   - Status-filtered queries (merchant_id, status)
--   - Sorted reputation histories (agent_id, created_at DESC)
--
-- After this migration, run:
--   SELECT query, calls, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 20;
-- to verify improvement.

-- ════════════════════════════════════════════════════════════════════════════════
-- yield-engine tables: yield_positions, yield_transactions, sweep_configs
-- ════════════════════════════════════════════════════════════════════════════════

-- compound index for agent-credit-lines query pattern: "positions by merchant + status"
CREATE INDEX IF NOT EXISTS idx_yield_positions_merchant_status
  ON yield_positions(merchant_id, status)
  WHERE status IN ('active', 'withdrawing');
COMMENT ON INDEX idx_yield_positions_merchant_status IS
  'Compound index for queries filtering positions by merchant_id and status; used by agent-credit-lines to find active merchant positions';

-- Foreign key index for vault lookups
CREATE INDEX IF NOT EXISTS idx_yield_positions_vault_id
  ON yield_positions(vault_id);
COMMENT ON INDEX idx_yield_positions_vault_id IS
  'Index on foreign key yield_positions.vault_id for fast vault-to-position joins';

-- Timestamp index for sorting by last_updated_at
CREATE INDEX IF NOT EXISTS idx_yield_positions_last_updated_at_desc
  ON yield_positions(last_updated_at DESC);
COMMENT ON INDEX idx_yield_positions_last_updated_at_desc IS
  'Index on last_updated_at DESC for efficient time-series queries; used by loadAllPositions()';

-- Compound index for merchant transaction history
CREATE INDEX IF NOT EXISTS idx_yield_transactions_merchant_created
  ON yield_transactions(merchant_id, created_at DESC)
  WHERE status IN ('confirmed', 'pending');
COMMENT ON INDEX idx_yield_transactions_merchant_created IS
  'Compound index for time-series transaction queries by merchant_id with status filter';

-- Foreign key index for position-to-transaction relationship
CREATE INDEX IF NOT EXISTS idx_yield_transactions_position_id
  ON yield_transactions(position_id);
COMMENT ON INDEX idx_yield_transactions_position_id IS
  'Index on foreign key yield_transactions.position_id for fast transaction lookups';

-- ════════════════════════════════════════════════════════════════════════════════
-- agent-identity tables: agent_identities, agent_reputation_events, agent_attestations
-- ════════════════════════════════════════════════════════════════════════════════

-- Compound index: reputation history sorted by creation time (for paginated reputation queries)
CREATE INDEX IF NOT EXISTS idx_agent_reputation_events_agent_created
  ON agent_reputation_events(agent_id, created_at DESC);
COMMENT ON INDEX idx_agent_reputation_events_agent_created IS
  'Compound index for sorted reputation history queries; used to fetch agent reputation events in reverse chronological order';

-- Owner/merchant index for agent lookup
CREATE INDEX IF NOT EXISTS idx_agent_identities_owner_merchant
  ON agent_identities(owner_merchant_id)
  WHERE status = 'active';
COMMENT ON INDEX idx_agent_identities_owner_merchant IS
  'Index on owner_merchant_id to quickly find all active agents owned by a merchant';

-- Foreign key index for subject agent lookups in attestations
CREATE INDEX IF NOT EXISTS idx_agent_attestations_subject_created
  ON agent_attestations(subject_agent_id, created_at DESC);
COMMENT ON INDEX idx_agent_attestations_subject_created IS
  'Compound index for attestation history queries sorted by creation time';

-- ════════════════════════════════════════════════════════════════════════════════
-- unified-router tables: forgepay_events, merchant_webhook_endpoints, webhook_delivery_log
-- ════════════════════════════════════════════════════════════════════════════════

-- Compound index for event log queries: "events for merchant sorted by time"
CREATE INDEX IF NOT EXISTS idx_forgepay_events_merchant_created
  ON forgepay_events(merchant_id, created_at DESC);
COMMENT ON INDEX idx_forgepay_events_merchant_created IS
  'Compound index for event log queries; primary access pattern for dashboard event history queries';

-- Index on event type for filtering across merchants
CREATE INDEX IF NOT EXISTS idx_forgepay_events_type_created
  ON forgepay_events(type, created_at DESC);
COMMENT ON INDEX idx_forgepay_events_type_created IS
  'Index for filtering events by type and timestamp; used for event log analytics';

-- Foreign key index for event-to-delivery join
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_event_id
  ON webhook_delivery_log(event_id);
COMMENT ON INDEX idx_webhook_delivery_log_event_id IS
  'Foreign key index for fast event-to-delivery lookups';

-- Compound index for delivery history by endpoint
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_log_endpoint_attempted
  ON webhook_delivery_log(endpoint_id, attempted_at DESC);
COMMENT ON INDEX idx_webhook_delivery_log_endpoint_attempted IS
  'Compound index for delivery history sorted by timestamp; used to show per-endpoint delivery attempts';

-- ════════════════════════════════════════════════════════════════════════════════
-- crypto-gateway tables: crypto_invoices
-- ════════════════════════════════════════════════════════════════════════════════

-- Compound index for merchant invoice lookup by status
CREATE INDEX IF NOT EXISTS idx_crypto_invoices_merchant_created
  ON crypto_invoices(merchant_id, created_at DESC)
  WHERE status IN ('pending', 'confirming', 'confirmed');
COMMENT ON INDEX idx_crypto_invoices_merchant_created IS
  'Compound index for merchant invoice history queries with status filter';

-- Index for finding expired invoices
CREATE INDEX IF NOT EXISTS idx_crypto_invoices_expires_at
  ON crypto_invoices(expires_at)
  WHERE status = 'pending';
COMMENT ON INDEX idx_crypto_invoices_expires_at IS
  'Index for finding expired pending invoices; used by cleanup jobs';

-- ════════════════════════════════════════════════════════════════════════════════
-- stablecoin-gateway tables: shielded_deposits, x402_shielded_payments
-- ════════════════════════════════════════════════════════════════════════════════

-- Compound index for active deposit lookups by merchant
CREATE INDEX IF NOT EXISTS idx_shielded_deposits_merchant_created
  ON shielded_deposits(merchant_id, created_at DESC)
  WHERE status IN ('pending', 'confirming', 'confirmed');
COMMENT ON INDEX idx_shielded_deposits_merchant_created IS
  'Compound index for merchant deposit queries filtered by status; primary dashboard query';

-- Foreign key index on nullifier
CREATE INDEX IF NOT EXISTS idx_shielded_deposits_nullifier_status
  ON shielded_deposits(nullifier, status);
COMMENT ON INDEX idx_shielded_deposits_nullifier_status IS
  'Index on nullifier with status for double-spend prevention and state tracking';

-- Compound index for x402 payments by merchant
CREATE INDEX IF NOT EXISTS idx_x402_shielded_merchant_created
  ON x402_shielded_payments(merchant_id, created_at DESC)
  WHERE status IN ('pending', 'confirming', 'confirmed');
COMMENT ON INDEX idx_x402_shielded_merchant_created IS
  'Compound index for x402 payment queries by merchant and time';

-- ════════════════════════════════════════════════════════════════════════════════
-- agent-credit-lines tables: credit_lines, credit_draws, credit_defaults
-- ════════════════════════════════════════════════════════════════════════════════

-- Compound index for draws by merchant with status
CREATE INDEX IF NOT EXISTS idx_credit_draws_merchant_status
  ON credit_draws(agent_id, status)
  WHERE status IN ('outstanding', 'overdue');
COMMENT ON INDEX idx_credit_draws_merchant_status IS
  'Compound index for finding outstanding or overdue draws for an agent';

-- Index for due date queries
CREATE INDEX IF NOT EXISTS idx_credit_draws_due_at_status
  ON credit_draws(due_at ASC)
  WHERE status IN ('outstanding', 'overdue');
COMMENT ON INDEX idx_credit_draws_due_at_status IS
  'Index for finding draws ordered by due date; used for payment reminders';

-- Foreign key index for credit line lookups
CREATE INDEX IF NOT EXISTS idx_credit_draws_credit_line_id
  ON credit_draws(credit_line_id);
COMMENT ON INDEX idx_credit_draws_credit_line_id IS
  'Foreign key index for credit line-to-draws relationship';

-- ════════════════════════════════════════════════════════════════════════════════
-- accounts-service tables: fp_accounts, fp_kyc_verifications, fp_deposits, fp_withdrawals, fp_account_transactions
-- ════════════════════════════════════════════════════════════════════════════════

-- Compound index for merchant account lookups
CREATE INDEX IF NOT EXISTS idx_fp_accounts_merchant_active
  ON fp_accounts(merchant_id, is_active)
  WHERE is_active = true;
COMMENT ON INDEX idx_fp_accounts_merchant_active IS
  'Compound index for finding active accounts by merchant';

-- Index for KYC status queries
CREATE INDEX IF NOT EXISTS idx_fp_accounts_merchant_kyc
  ON fp_accounts(merchant_id, kyc_status);
COMMENT ON INDEX idx_fp_accounts_merchant_kyc IS
  'Index for KYC status filtering by merchant';

-- Compound index for deposit history
CREATE INDEX IF NOT EXISTS idx_fp_deposits_merchant_created
  ON fp_deposits(merchant_id, created_at DESC)
  WHERE status IN ('pending', 'confirmed');
COMMENT ON INDEX idx_fp_deposits_merchant_created IS
  'Compound index for merchant deposit history queries';

-- Compound index for withdrawal history
CREATE INDEX IF NOT EXISTS idx_fp_withdrawals_merchant_created
  ON fp_withdrawals(merchant_id, created_at DESC)
  WHERE status IN ('pending', 'processing', 'completed');
COMMENT ON INDEX idx_fp_withdrawals_merchant_created IS
  'Compound index for merchant withdrawal history queries';

-- Compound index for transaction history by merchant
CREATE INDEX IF NOT EXISTS idx_fp_txns_merchant_created
  ON fp_account_transactions(merchant_id, created_at DESC);
COMMENT ON INDEX idx_fp_txns_merchant_created IS
  'Compound index for unified transaction history queries by merchant; replaces sequential scan on full table';

-- Index for fraud detection queries
CREATE INDEX IF NOT EXISTS idx_fp_txns_merchant_fraud
  ON fp_account_transactions(merchant_id, fraud_decision)
  WHERE fraud_decision IN ('review', 'block');
COMMENT ON INDEX idx_fp_txns_merchant_fraud IS
  'Index for querying high-risk or blocked transactions';

-- ════════════════════════════════════════════════════════════════════════════════
-- Update query statistics for query planner
-- ════════════════════════════════════════════════════════════════════════════════

-- Analyze table statistics so the query planner uses the new indexes
ANALYZE yield_positions;
ANALYZE yield_transactions;
ANALYZE sweep_configs;
ANALYZE agent_identities;
ANALYZE agent_reputation_events;
ANALYZE agent_attestations;
ANALYZE forgepay_events;
ANALYZE merchant_webhook_endpoints;
ANALYZE webhook_delivery_log;
ANALYZE crypto_invoices;
ANALYZE shielded_deposits;
ANALYZE x402_shielded_payments;
ANALYZE credit_lines;
ANALYZE credit_draws;
ANALYZE credit_defaults;
ANALYZE fp_accounts;
ANALYZE fp_kyc_verifications;
ANALYZE fp_deposits;
ANALYZE fp_withdrawals;
ANALYZE fp_account_transactions;

-- ════════════════════════════════════════════════════════════════════════════════
-- PostgreSQL Monitoring Setup
-- ════════════════════════════════════════════════════════════════════════════════

-- Enable pg_stat_statements extension for query performance monitoring
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- After running this migration, you can query slow queries:
--   SELECT query, calls, mean_time, max_time FROM pg_stat_statements
--   ORDER BY mean_time DESC LIMIT 20;
--
-- To reset statistics:
--   SELECT pg_stat_statements_reset();

-- ════════════════════════════════════════════════════════════════════════════════
-- Verification Queries (example EXPLAIN ANALYZE before/after)
-- ════════════════════════════════════════════════════════════════════════════════

-- Before optimization, this would do a sequential scan on 1M+ rows:
-- EXPLAIN ANALYZE SELECT * FROM yield_positions
-- WHERE merchant_id = 'merchant-123' AND status = 'active'
-- ORDER BY last_updated_at DESC LIMIT 10;
--
-- After this migration, should use idx_yield_positions_merchant_status:
-- Plan should show "Index Scan using idx_yield_positions_merchant_status..."
--
-- Similar improvements apply to all compound indexes above.

-- ════════════════════════════════════════════════════════════════════════════════
-- Notes for Performance Monitoring
-- ════════════════════════════════════════════════════════════════════════════════
-- 1. Enable slow query logging in postgresql.conf:
--    log_min_duration_statement = 500  (log queries slower than 500ms)
--
-- 2. Query the slow log from PostgreSQL:
--    SELECT * FROM pg_log WHERE duration > 500;
--
-- 3. Monitor index usage:
--    SELECT schemaname, tablename, indexname, idx_scan
--    FROM pg_stat_user_indexes
--    ORDER BY idx_scan DESC;
--
-- 4. Find missing indexes (seq_scan > idx_scan indicates missing indexes):
--    SELECT schemaname, tablename, seq_scan, seq_tup_read, idx_scan
--    FROM pg_stat_user_tables
--    WHERE seq_tup_read > 100000 AND idx_scan < 1
--    ORDER BY seq_scan DESC;
